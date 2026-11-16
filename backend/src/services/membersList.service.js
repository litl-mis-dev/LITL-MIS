const prisma = require('../lib/prisma')
const { logError } = require('../utils/logger')
const { isValidStudentNumber } = require('../utils/validators')
const { MEMBERSHIP_USER_FILTER } = require('../utils/roles')
const { approvePendingUser } = require('./memberApproval.service')

// Members List: the officer-uploaded list of students allowed to join. A
// registration waiting for approval is approved automatically when its
// student number AND last name match a Members List entry AND it was made with a
// CvSU email. Student numbers and last names aren't secret, so a matching
// registration with a personal email could be someone else using a
// classmate's details: it is left for an officer to review, like a name
// mismatch. Nobody is ever rejected automatically.

const MAX_MEMBERS_LIST_ROWS = 5000
const LAST_NAME_REGEX = /^[\p{L}\s'.-]+$/u

// "Dela Cruz", "dela cruz" and "De La Cruz" all compare equal, as do "Peña"
// and "Pena": accents, case, spaces, dots, hyphens and apostrophes are ignored.
function normalizeLastName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

function displayName(member) {
  return [member?.firstName, member?.middleName, member?.lastName, member?.suffix].filter(Boolean).join(' ')
}

// rows: [{ row, studentNumber, lastName }] as read from the uploaded file.
// Returns the valid entries (by student number) and every rejected row with
// the reason, so the officer can fix the file.
function validateMembersListRows(rows) {
  const entries = new Map()
  const invalid = []

  rows.forEach((raw, index) => {
    const row = Number.isInteger(raw?.row) ? raw.row : index + 1
    const studentNumber = typeof raw?.studentNumber === 'string' || typeof raw?.studentNumber === 'number'
      ? String(raw.studentNumber).trim() : ''
    const lastName = typeof raw?.lastName === 'string' ? raw.lastName.trim().replace(/\s+/g, ' ') : ''

    if (!studentNumber && !lastName) return // blank line
    if (!isValidStudentNumber(studentNumber)) {
      invalid.push({ row, studentNumber, lastName, reason: 'Student number must look like 2023-100-123.' })
    } else if (!lastName || lastName.length > 60 || !LAST_NAME_REGEX.test(lastName) || !normalizeLastName(lastName)) {
      invalid.push({ row, studentNumber, lastName, reason: 'Last name is missing or has invalid characters.' })
    } else if (entries.has(studentNumber) && normalizeLastName(entries.get(studentNumber)) !== normalizeLastName(lastName)) {
      invalid.push({ row, studentNumber, lastName, reason: 'This student number appears more than once with different last names.' })
    } else {
      entries.set(studentNumber, lastName)
    }
  })

  return { entries, invalid }
}

// What saving these entries would do. `mode` is 'add' (merge into the
// list: new numbers added, changed last names updated) or 'replace' (the
// list becomes exactly this one).
async function buildMembersListPlan(entries, mode) {
  const current = await prisma.membersListEntry.findMany({ select: { studentNumber: true, lastName: true } })
  const currentByNumber = new Map(current.map((e) => [e.studentNumber, e.lastName]))

  const toCreate = []
  const toUpdate = []
  let unchanged = 0
  for (const [studentNumber, lastName] of entries) {
    if (!currentByNumber.has(studentNumber)) toCreate.push({ studentNumber, lastName })
    else if (currentByNumber.get(studentNumber) !== lastName) toUpdate.push({ studentNumber, lastName })
    else unchanged++
  }
  const toRemove = mode === 'replace'
    ? current.filter((e) => !entries.has(e.studentNumber)).map((e) => e.studentNumber)
    : []

  // The Members List as it will be after saving.
  const after = new Map(mode === 'replace' ? [] : currentByNumber)
  for (const [studentNumber, lastName] of entries) after.set(studentNumber, lastName)

  const pending = await prisma.user.findMany({
    where: { status: 'PENDING_OFFICER_APPROVAL', studentNumber: { not: null }, ...MEMBERSHIP_USER_FILTER },
    select: {
      id: true, studentNumber: true, emailType: true,
      member: { select: { firstName: true, middleName: true, lastName: true, suffix: true } },
    },
  })
  const willApprove = []
  const nameMismatch = []
  const personalEmail = []
  let pendingNotListed = 0
  for (const user of pending) {
    const listLastName = after.get(user.studentNumber)
    const item = { userId: user.id, name: displayName(user.member), studentNumber: user.studentNumber }
    if (listLastName === undefined) pendingNotListed++
    else if (normalizeLastName(listLastName) !== normalizeLastName(user.member?.lastName)) nameMismatch.push({ ...item, listLastName })
    else if (user.emailType !== 'CVSU') personalEmail.push(item)
    else willApprove.push(item)
  }

  const uploadedNumbers = [...entries.keys()]
  const registered = uploadedNumbers.length
    ? await prisma.user.count({ where: { studentNumber: { in: uploadedNumbers } } })
    : 0

  return {
    mode,
    toCreate, toUpdate, toRemove,
    summary: {
      validRows: entries.size,
      added: toCreate.length,
      updated: toUpdate.length,
      unchanged,
      removed: toRemove.length,
      listSizeAfter: after.size,
      notRegisteredYet: uploadedNumbers.length - registered,
      pendingNotListed,
    },
    willApprove,
    nameMismatch,
    personalEmail,
  }
}

// Saves the plan, then approves every pending registration that now matches.
async function applyMembersListPlan(plan, actorId) {
  await prisma.$transaction([
    ...(plan.mode === 'replace' ? [prisma.membersListEntry.deleteMany({ where: { studentNumber: { in: plan.toRemove } } })] : []),
    ...(plan.toCreate.length
      ? [prisma.membersListEntry.createMany({ data: plan.toCreate.map((e) => ({ ...e, addedById: actorId })), skipDuplicates: true })]
      : []),
    ...plan.toUpdate.map((e) => prisma.membersListEntry.update({
      where: { studentNumber: e.studentNumber },
      data: { lastName: e.lastName, addedById: actorId },
    })),
  ])

  const approved = []
  for (const item of plan.willApprove) {
    try {
      const result = await approvePendingUser(item.userId, { actorId, via: 'MEMBERS_LIST' })
      if (result.approved) approved.push(item)
    } catch (err) {
      logError('Members List approval failed', err, { userId: item.userId })
    }
  }
  return approved
}

// Called right after a registrant verifies their email: approve them at once
// when they are on the Members List with a matching last name. Returns true when
// the account was approved.
async function approveIfOnMembersList(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, studentNumber: true, role: true, emailType: true, member: { select: { lastName: true } } },
  })
  if (!user || user.status !== 'PENDING_OFFICER_APPROVAL' || user.role !== 'MEMBER' || !user.studentNumber) return false
  if (user.emailType !== 'CVSU') return false // personal email: an officer reviews it

  const entry = await prisma.membersListEntry.findUnique({ where: { studentNumber: user.studentNumber } })
  if (!entry || normalizeLastName(entry.lastName) !== normalizeLastName(user.member?.lastName)) return false

  const { approved } = await approvePendingUser(userId, { actorId: null, via: 'MEMBERS_LIST' })
  return approved
}

module.exports = {
  MAX_MEMBERS_LIST_ROWS,
  normalizeLastName,
  validateMembersListRows,
  buildMembersListPlan,
  applyMembersListPlan,
  approveIfOnMembersList,
}
