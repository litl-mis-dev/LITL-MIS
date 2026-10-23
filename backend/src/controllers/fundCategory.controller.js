const Decimal = require('decimal.js')
const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { writeAuditLog } = require('../utils/auditLog')
const { AUDIT_ACTIONS } = require('../utils/auditActions')
const {
  getFundReport,
  getTotalCategoryPercentage
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

const updateCategory = async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { name, percentage } = req.body

    const category = await prisma.fundCategory.findUnique({ where: { id } })
    if (!category || category.isArchived) return res.status(404).json({ message: 'Category not found.' })

    if (category.isTurnoverFund) {
      return res.status(400).json({ message: 'The Turnover Fund category is managed automatically and cannot be edited.' })
    }

    if (name && name.trim().toLowerCase() === RESERVED_CATEGORY_NAME) {
      return res.status(400).json({ message: '"Turnover Fund" is a reserved, system-generated name.' })
    }

    let parsedPercentage = null
    if (percentage !== undefined) {
      parsedPercentage = new Decimal(percentage)
      if (parsedPercentage.lte(0) || parsedPercentage.gt(100)) {
        return res.status(400).json({ message: 'Percentage must be between 0 and 100.' })
      }
      const currentTotal = await getTotalCategoryPercentage(category.semesterId, id)
      if (currentTotal.plus(parsedPercentage).gt(100)) {
        return res.status(400).json({
          message: `This would bring the total to ${currentTotal.plus(parsedPercentage).toFixed(2)}%, exceeding 100%.`
        })
      }
    }

    if (name && name.trim() !== category.name) {
      const existing = await prisma.fundCategory.findUnique({
        where: { name_semesterId: { name: name.trim(), semesterId: category.semesterId } }
      })
      if (existing) return res.status(400).json({ message: 'A category with this name already exists.' })
    }

    const previousName = category.name
    const previousPercentage = parseFloat(category.percentage)

    const updated = await prisma.fundCategory.update({
      where: { id },
      data: {
        ...(name && { name: name.trim() }),
        ...(parsedPercentage && { percentage: parsedPercentage.toFixed(2) })
      }
    })

    await writeAuditLog({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.CATEGORY_UPDATED,
      details: {
        categoryId: id,
        previousName,
        previousPercentage,
        name: updated.name,
        percentage: parseFloat(updated.percentage)
      }
    })

    return res.json({ message: 'Category updated.', category: updated })
  } catch (err) {
    logError('Update category', err)
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

module.exports = { listCategories, createCategoriesBatch, archiveCategory }