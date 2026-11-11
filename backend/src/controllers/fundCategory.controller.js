const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const {
  getFundReport,
  getTotalCategoryPercentage,
  getCategoryFinancials
} = require('../services/calculations.service')
const { emitToOfficers } = require('../realtime/socket')

const RESERVED_CATEGORY_NAME = 'turnover fund'

const listCategories = async (req, res) => {
  try {
    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })
      
    return res.json(await getFundReport(activeSemester))
  } catch (err) {
    logError('List categories', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const createCategoriesBatch = async (req, res) => {
  try {

    const { categories, confirmText } = req.body

    if (!confirmText || confirmText.trim() !== 'CONFIRM') {
      return res.status(400).json({ message: 'You must type CONFIRM to confirm.' })
    }

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ message: 'At least one category is required.' })
    }

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    if (activeSemester.semester === 'SECOND') {
      return res.status(403).json({
        message: 'Fund categories cannot be added during the 2nd Semester. Categories are shared across the school year and were finalized in the 1st Semester.'
      })
    }

    const existingCount = await prisma.fundCategory.count({
      where: {
        semesterId: activeSemester.id,
        isArchived: false,
        isTurnoverFund: false
      }
    })
    if (existingCount > 0) {
      return res.status(403).json({
        message: 'Fund categories have already been finalized for this semester and cannot be modified.'
      })
    }

    const errors = []
    let batchTotal = new Decimal(0)

    for (const [i, cat] of categories.entries()) {
      const name = cat.name || cat.categories
      if (!name || !name.trim() || name.trim().length < 2 || name.trim().length > 100) {
        errors.push(`Category ${i + 1}: Name must be 2–100 characters.`)
      } else if (name.trim().toLowerCase() === RESERVED_CATEGORY_NAME) {
        errors.push(`Category ${i + 1}: "Turnover Fund" is a reserved, system-generated name.`)
      }
      if (!cat.percentage) {
        errors.push(`Category ${i + 1}: Percentage is required.`)
      } else {
        const p = new Decimal(cat.percentage)
        if (p.lte(0) || p.gt(100)) {
          errors.push(`Category ${i + 1}: Percentage must be between 0 and 100.`)
        } else {
          batchTotal = batchTotal.plus(p)
        }
      }
    }
    if (errors.length > 0) return res.status(400).json({ message: errors.join(' ') })

    const currentTotal = await getTotalCategoryPercentage(activeSemester.id)
    const projectedTotal = currentTotal.plus(batchTotal)
    if (!projectedTotal.equals(100)) {
      return res.status(400).json({
        message: `Total fund allocation must equal exactly 100%. Current: ${currentTotal.toFixed(2)}%. Adding: ${batchTotal.toFixed(2)}%. Projected: ${projectedTotal.toFixed(2)}%.`
      })
    }

    for (const cat of categories) {
      const name = (cat.name || cat.categories).trim()
      const existing = await prisma.fundCategory.findUnique({
        where: { name_semesterId: { name, semesterId: activeSemester.id } }
      })
      if (existing) return res.status(400).json({ message: `Category "${name}" already exists for this semester.` })
    }

    const created = await prisma.$transaction(
      categories.map(cat =>
        prisma.fundCategory.create({
          data: {
            name: (cat.name || cat.categories).trim(),
            percentage: new Decimal(cat.percentage).toFixed(2),
            semesterId: activeSemester.id,
            createdById: req.user.id
          }
        })
      )
    )

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CATEGORY_CREATED,
      details: {
        names: created.map(c => c.name),
        percentages: created.map(c => parseFloat(c.percentage))
      }
    })

    // Categories being finalized is what unlocks Disbursement — the Disbursement
    // screen listens for this so "Add Disbursement" enables live, without a
    // manual refresh, the moment a semester's categories are finalized.
    emitToOfficers('fundCategory:changed', { semesterId: activeSemester.id, action: 'created' })

    return res.status(201).json({ message: 'Categories created.', categories: created })
  } catch (err) {
    logError('Batch create categories', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

const archiveCategory = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const category = await prisma.fundCategory.findUnique({ where: { id } })
    if (!category || category.isArchived) return res.status(404).json({ message: 'Category not found.' })

    const activeDisbursements = await prisma.disbursement.count({ where: { fundCategoryId: id, isArchived: false } })
    if (activeDisbursements > 0) {
      return res.status(400).json({ message: 'Cannot archive a category that has active disbursements.' })
    }

    await prisma.fundCategory.update({ where: { id }, data: { isArchived: true } })

    emitToOfficers('fundCategory:changed', { categoryId: id, action: 'archived' })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CATEGORY_ARCHIVED,
      details: { categoryId: id, name: category.name }
    })

    return res.json({ message: 'Category archived.' })
  } catch (err) {
    logError('Archive category', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

// PUT /api/financial/categories
// Renames categories, changes their percentages and adds new ones at any
// time. Every regular category of the current school year must be sent (new
// ones without an id), so the total can be checked: it must stay exactly
// 100%. A category's share can only go down while it still covers what it
// has already spent. Each changed category gets its own CATEGORY_UPDATED
// entry in the hash-linked ledger; new ones get one CATEGORY_CREATED entry.
const updateCategories = async (req, res) => {
  try {
    const { categories, confirmText } = req.body

    if (!confirmText || confirmText.trim() !== 'CONFIRM') {
      return res.status(400).json({ message: 'You must type CONFIRM to confirm.' })
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ message: 'At least one category is required.' })
    }

    const activeSemester = await prisma.semester.findFirst({ where: { isActive: true } })
    if (!activeSemester) return res.status(400).json({ message: 'No active semester.' })

    // Same set the Fund Report shows: the school year's regular categories.
    const semestersInSchoolYear = await prisma.semester.findMany({
      where: { schoolYear: activeSemester.schoolYear },
      select: { id: true, semester: true }
    })
    const existing = await prisma.fundCategory.findMany({
      where: {
        semesterId: { in: semestersInSchoolYear.map(s => s.id) },
        isTurnoverFund: false,
        isArchived: false
      }
    })
    if (existing.length === 0) {
      return res.status(400).json({ message: 'There are no fund categories to edit yet.' })
    }

    const byId = new Map(existing.map(c => [c.id, c]))
    const isNew = (cat) => cat?.id === null || cat?.id === undefined || cat?.id === ''
    const sentIds = categories.filter(c => !isNew(c)).map(c => Number(c.id))
    if (new Set(sentIds).size !== sentIds.length || sentIds.length !== existing.length || !sentIds.every(id => byId.has(id))) {
      return res.status(400).json({ message: 'The category list is out of date. Please reopen the editor and try again.' })
    }

    const errors = []
    const seenNames = new Set()
    let total = new Decimal(0)
    const edits = []

    for (const [i, cat] of categories.entries()) {
      const name = typeof cat.name === 'string' ? cat.name.trim() : ''
      if (name.length < 2 || name.length > 100) {
        errors.push(`Category ${i + 1}: Name must be 2–100 characters.`)
      } else if (name.toLowerCase() === RESERVED_CATEGORY_NAME) {
        errors.push(`Category ${i + 1}: "Turnover Fund" is a reserved, system-generated name.`)
      } else if (seenNames.has(name.toLowerCase())) {
        errors.push(`Category ${i + 1}: "${name}" is used more than once.`)
      }
      seenNames.add(name.toLowerCase())

      let percentage = null
      try { percentage = new Decimal(cat.percentage) } catch { percentage = null }
      if (!percentage || percentage.isNaN() || percentage.lte(0) || percentage.gt(100) || percentage.decimalPlaces() > 2) {
        errors.push(`Category ${i + 1}: Percentage must be between 0 and 100.`)
      } else {
        total = total.plus(percentage)
      }

      edits.push({ before: isNew(cat) ? null : byId.get(Number(cat.id)), name, percentage })
    }
    if (errors.length > 0) return res.status(400).json({ message: errors.join(' ') })

    if (!total.equals(100)) {
      return res.status(400).json({ message: `Total fund allocation must equal exactly 100%. Current total: ${total.toFixed(2)}%.` })
    }

    const countedSemesterIds = semestersInSchoolYear
      .filter(s => s.semester === 'FIRST' || s.id === activeSemester.id)
      .map(s => s.id)

    const added = edits.filter(e => !e.before)
    const changed = edits.filter(e =>
      e.before && (e.name !== e.before.name || !e.percentage.equals(e.before.percentage))
    )
    if (changed.length === 0 && added.length === 0) {
      return res.status(400).json({ message: 'No changes to save.' })
    }
    // New categories join the school year's existing ones (same semester row).
    const categorySemesterId = existing[0].semesterId

    for (const edit of changed) {
      if (!edit.percentage.lt(edit.before.percentage)) continue
      const after = await getCategoryFinancials(
        { ...edit.before, percentage: edit.percentage.toFixed(2) },
        activeSemester.id,
        countedSemesterIds
      )
      const netSpent = new Decimal(after.totalDisbursed).minus(after.totalReturned)
      if (new Decimal(after.allocatedAmount).lt(netSpent)) {
        return res.status(400).json({
          message: `"${edit.before.name}" has already used ₱${netSpent.toFixed(2)}, so its share can't be lowered to ${edit.percentage.toFixed(2)}%.`
        })
      }
    }

    try {
      await prisma.$transaction([
        ...changed.map(edit => prisma.fundCategory.update({
          where: { id: edit.before.id },
          data: { name: edit.name, percentage: edit.percentage.toFixed(2) }
        })),
        ...added.map(edit => prisma.fundCategory.create({
          data: {
            name: edit.name,
            percentage: edit.percentage.toFixed(2),
            semesterId: categorySemesterId,
            createdById: req.user.id
          }
        }))
      ])
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(400).json({ message: 'Another category in this semester already has one of those names.' })
      }
      throw err
    }

    for (const edit of changed) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.CATEGORY_UPDATED,
        details: {
          categoryId: edit.before.id,
          semesterId: edit.before.semesterId,
          previousName: edit.before.name,
          name: edit.name,
          previousPercentage: parseFloat(edit.before.percentage),
          percentage: parseFloat(edit.percentage),
          snapshot: { id: edit.before.id, name: edit.name, percentage: edit.percentage.toFixed(2) }
        }
      })
    }

    if (added.length > 0) {
      await writeAuditLog({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.CATEGORY_CREATED,
        details: {
          names: added.map(e => e.name),
          percentages: added.map(e => parseFloat(e.percentage)),
          semesterId: categorySemesterId
        }
      })
    }

    emitToOfficers('fundCategory:changed', { semesterId: activeSemester.id, action: 'updated' })

    const parts = []
    if (changed.length) parts.push(`updated ${changed.length} categor${changed.length === 1 ? 'y' : 'ies'}`)
    if (added.length) parts.push(`added ${added.length} new categor${added.length === 1 ? 'y' : 'ies'}`)
    const summary = parts.join(' and ')
    return res.json({ message: `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.` })
  } catch (err) {
    logError('Update categories', err)
    return res.status(500).json({ message: 'Something went wrong.' })
  }
}

module.exports = { listCategories, createCategoriesBatch, archiveCategory, updateCategories }