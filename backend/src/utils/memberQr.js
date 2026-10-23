const QRCode = require('qrcode')

function getMemberName(member) {
  return [
    member.firstName,
    member.middleName,
    member.lastName,
    member.suffix
  ].filter(Boolean).join(' ')
}

function buildMemberQrPayload(member) {
  return {
    name: getMemberName(member),
    studentNumber: member.studentNumber
  }
}

function buildMemberQrText(member) {
  const payload = buildMemberQrPayload(member)
  return `${payload.name}\n${payload.studentNumber}`
}

async function generateMemberQrCode(member) {
  const payload = buildMemberQrText(member)

  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320
  })
}

module.exports = {
  buildMemberQrPayload,
  buildMemberQrText,
  generateMemberQrCode,
  getMemberName
}
