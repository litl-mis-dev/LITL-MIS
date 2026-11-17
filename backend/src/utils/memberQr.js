const crypto = require('crypto')
const QRCode = require('qrcode')

// A member's QR code is "LITL1.<member ID in base 36>.<signature>", e.g.
// "LITL1.2.Hf3kQ9xP2mWvYb7LqT0aZw". The signature is an HMAC made with
// QR_SIGNING_SECRET, which only the server has, so a QR made anywhere else
// (a free QR generator, an edited code) is refused at check-in. The code holds
// no name or student number: other QR apps read text that means nothing.
// "LITL1" names the format, so a later LITL2 can be accepted alongside it.
const QR_PREFIX = 'LITL1'
const SIGNATURE_LENGTH = 22 // 128 bits of HMAC-SHA256 in base64url

// What both scanners say about a QR this server didn't make.
const INVALID_MEMBER_QR_MESSAGE = "This QR code isn't a valid LITL membership card."

function sign(body) {
  return crypto
    .createHmac('sha256', process.env.QR_SIGNING_SECRET)
    .update(body)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH)
}

// The text inside a member's QR code.
function buildMemberQrText(memberId) {
  const body = `${QR_PREFIX}.${Number(memberId).toString(36).toUpperCase()}`
  return `${body}.${sign(body)}`
}

// Returns { memberId } for a QR made by this server, or { error }:
// 'NOT_LITL' when it isn't a LITL code at all, 'INVALID' when it looks like
// one but the signature doesn't match (made elsewhere or edited).
function parseMemberQrText(text) {
  const value = String(text ?? '').trim()
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return { error: 'NOT_LITL' }

  const [, idPart, signature] = parts
  if (!/^[0-9A-Z]{1,10}$/.test(idPart) || signature.length !== SIGNATURE_LENGTH) return { error: 'INVALID' }

  const expected = Buffer.from(sign(`${QR_PREFIX}.${idPart}`))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'INVALID' }

  const memberId = parseInt(idPart, 36)
  return Number.isSafeInteger(memberId) && memberId > 0 ? { memberId } : { error: 'INVALID' }
}

async function generateMemberQrCode(memberId) {
  return QRCode.toDataURL(buildMemberQrText(memberId), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320
  })
}

module.exports = {
  QR_PREFIX,
  INVALID_MEMBER_QR_MESSAGE,
  buildMemberQrText,
  parseMemberQrText,
  generateMemberQrCode
}
