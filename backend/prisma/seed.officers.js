// ============================================================================
// Seed one login account per officer role (19 roles) + one plain MEMBER.
// Every account uses the SAME password: Officer@123
// Password is hashed at runtime with bcrypt (12 rounds), same as
// src/controllers/auth.controller.js, so it always matches the bcrypt
// version actually installed in this project.
//
// Safe to re-run: uses upsert on email, so running it twice won't error on
// duplicates — it'll just leave existing rows as-is.
//
// Run with:
//   node prisma/seed.officers.js
// ============================================================================

const bcrypt = require('bcrypt')
const prisma = require('../src/lib/prisma')
require('dotenv').config()
if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
  console.error('REFUSING TO RUN: seed.officers.js creates accounts with a known password (Officer@123).')
  console.error('It must never be used on a production database. Use prisma/create-initial-admin.js instead.')
  process.exit(1)
}

const PASSWORD = 'Officer@123'

const ACCOUNTS = [
  { studentNumber: '2024-100-00001', email: 'president@litl.test',     role: 'PRESIDENT_ADMIN',                     firstName: 'Juan',         lastName: 'DelaCruz',     sex: 'MALE',   yearLevel: '4th Year', section: 'A' },
  { studentNumber: '2024-100-00002', email: 'vicepresident@litl.test', role: 'VICE_PRESIDENT_ADMIN',                firstName: 'Maria',        lastName: 'Santos',       sex: 'FEMALE', yearLevel: '4th Year', section: 'A' },
  { studentNumber: '2024-100-00003', email: 'secretary@litl.test',     role: 'SECRETARY',                           firstName: 'Ana',          lastName: 'Reyes',        sex: 'FEMALE', yearLevel: '3rd Year', section: 'B' },
  { studentNumber: '2024-100-00004', email: 'sen.internal@litl.test',  role: 'SEN_INTERNAL_AFFAIRS',                firstName: 'Carlo',        lastName: 'Ramos',        sex: 'MALE',   yearLevel: '3rd Year', section: 'A' },
  { studentNumber: '2024-100-00005', email: 'sen.external@litl.test',  role: 'SEN_EXTERNAL_AFFAIRS',                firstName: 'Bea',          lastName: 'Torres',       sex: 'FEMALE', yearLevel: '3rd Year', section: 'B' },
  { studentNumber: '2024-100-00006', email: 'sen.finance@litl.test',   role: 'SEN_FINANCE',                         firstName: 'Miguel',       lastName: 'Garcia',       sex: 'MALE',   yearLevel: '3rd Year', section: 'A' },
  { studentNumber: '2024-100-00007', email: 'sen.audit@litl.test',     role: 'SEN_AUDIT',                           firstName: 'Angelo',       lastName: 'Cruz',         sex: 'MALE',   yearLevel: '2nd Year', section: 'A' },
  { studentNumber: '2024-100-00008', email: 'sen.business@litl.test',  role: 'SEN_BUSINESS_AFFAIRS',                firstName: 'Diana',        lastName: 'Flores',       sex: 'FEMALE', yearLevel: '2nd Year', section: 'B' },
  { studentNumber: '2024-100-00009', email: 'sen.logistics@litl.test', role: 'SEN_LOGISTICS_PROPERTIES',            firstName: 'Paolo',        lastName: 'Aquino',       sex: 'MALE',   yearLevel: '2nd Year', section: 'A' },
  { studentNumber: '2024-100-00010', email: 'sen.publicity@litl.test', role: 'SEN_PUBLICITY_INFORMATION',           firstName: 'Kim',          lastName: 'Mendoza',      sex: 'FEMALE', yearLevel: '2nd Year', section: 'B' },
  { studentNumber: '2024-100-00011', email: 'sen.academic@litl.test',  role: 'SEN_ACADEMIC_AFFAIRS',                firstName: 'Rafael',       lastName: 'Bautista',     sex: 'MALE',   yearLevel: '1st Year', section: 'A' },
  { studentNumber: '2024-100-00012', email: 'sen.rules@litl.test',     role: 'SEN_RULES_CONSTITUTIONAL_AMENDMENTS', firstName: 'Samantha',     lastName: 'Villanueva',   sex: 'FEMALE', yearLevel: '1st Year', section: 'B' },
  { studentNumber: '2024-100-00013', email: 'sen.sports@litl.test',    role: 'SEN_SPORTS_ARTS_CULTURE',             firstName: 'Josh',         lastName: 'Navarro',      sex: 'MALE',   yearLevel: '1st Year', section: 'A' },
  { studentNumber: '2024-100-00014', email: 'sen.welfare@litl.test',   role: 'SEN_STUDENT_RIGHTS_WELFARE',          firstName: 'Ella',         lastName: 'Castillo',     sex: 'FEMALE', yearLevel: '1st Year', section: 'B' },
  { studentNumber: '2024-100-00015', email: 'rep1@litl.test',          role: 'YEAR_REP_1',                          firstName: 'Nico',         lastName: 'Pascual',      sex: 'MALE',   yearLevel: '1st Year', section: 'A' },
  { studentNumber: '2024-100-00016', email: 'rep2@litl.test',          role: 'YEAR_REP_2',                          firstName: 'Trisha',       lastName: 'Domingo',      sex: 'FEMALE', yearLevel: '2nd Year', section: 'A' },
  { studentNumber: '2024-100-00017', email: 'rep3@litl.test',          role: 'YEAR_REP_3',                          firstName: 'Marco',        lastName: 'Salazar',      sex: 'MALE',   yearLevel: '3rd Year', section: 'A' },
  { studentNumber: '2024-100-00018', email: 'rep4@litl.test',          role: 'YEAR_REP_4',                          firstName: 'Patricia',     lastName: 'Lopez',        sex: 'FEMALE', yearLevel: '4th Year', section: 'B' },
  { studentNumber: '2024-200-00001', email: 'adviser@litl.test',       role: 'ADVISER_DEPT_CHAIR',                  firstName: 'Dr. Roberto',  lastName: 'Fernandez',    sex: 'MALE',   yearLevel: 'N/A',      section: 'N/A' },
  { studentNumber: '2024-100-00019', email: 'member@litl.test',        role: 'MEMBER',                              firstName: 'Liza',         lastName: 'Gonzales',     sex: 'FEMALE', yearLevel: '2nd Year', section: 'C' },
]

async function seedOfficers() {
  console.log('Seeding officer + member accounts...')
  const passwordHash = await bcrypt.hash(PASSWORD, 12)

  for (const acc of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: acc.email },
      update: {}, // leave existing accounts untouched on re-run
      create: {
        studentNumber: acc.studentNumber,
        email:         acc.email,
        emailType:     'PERSONAL',
        password:      passwordHash,
        role:          acc.role,
        status:        'APPROVED',
      },
    })

    await prisma.member.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId:    user.id,
        firstName: acc.firstName,
        lastName:  acc.lastName,
        sex:       acc.sex,
        yearLevel: acc.yearLevel,
        section:   acc.section,
        status:    'ACTIVE',
      },
    })

    console.log(`  ✓ ${acc.role.padEnd(38)} ${acc.email}`)
  }

  console.log(`Done — ${ACCOUNTS.length} accounts seeded. Password for all: ${PASSWORD}`)
}

seedOfficers()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())