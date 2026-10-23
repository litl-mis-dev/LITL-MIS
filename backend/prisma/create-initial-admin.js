// Promotes ONE already-registered account to PRESIDENT_ADMIN on an empty database.
// Usage: node prisma/create-initial-admin.js president@example.com
require('dotenv').config()
const prisma = require('../src/lib/prisma')

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase()
  if (!email) {
    console.error('Usage: node prisma/create-initial-admin.js <registered-email>')
    process.exit(1)
  }

  const existingPresident = await prisma.user.findFirst({ where: { role: 'PRESIDENT_ADMIN' } })
  if (existingPresident) {
    console.error(`A President already exists (user #${existingPresident.id}). Nothing changed.`)
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { member: true } })
  if (!user || !user.member) {
    console.error('No registered account with a member profile was found for that email. Register on the website first.')
    process.exit(1)
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: 'PRESIDENT_ADMIN', status: 'APPROVED' } })
    await tx.member.update({ where: { id: user.member.id }, data: { status: 'ACTIVE' } })
    await tx.officerAssignment.create({
      data: { memberId: user.member.id, role: 'PRESIDENT_ADMIN', activeRole: 'PRESIDENT_ADMIN', assignedById: user.id, status: 'ACTIVE' },
    })
  })

  console.log(`Done: ${email} is now the President.`)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())