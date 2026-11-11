// Express 5 leaves req.body undefined when no body parser ran (no body, or a
// Content-Type other than JSON). Handlers destructure req.body, which then
// threw and answered 500. With an empty object they validate as usual and
// answer 400 for the missing fields.
const defaultEmptyBody = (req, res, next) => {
  if (req.body === undefined) req.body = {}
  next()
}

// Any path no route matched: a JSON 404 rather than Express's HTML
// "Cannot GET …" page, which also gave away the framework.
const jsonNotFound = (req, res) => {
  res.status(404).json({ message: 'Not found' })
}

// Route IDs are database integers. Without this, "/documents/abc" became
// Number('abc') = NaN, Prisma rejected it and the handler answered 500.
// Registered per router for its numeric parameters; text parameters
// (publicId, studentNumber, assetType) are left alone.
const MAX_INT = 2147483647
const validateIdParams = (router, names) => {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (/^\d{1,10}$/.test(value) && Number(value) > 0 && Number(value) <= MAX_INT) return next()
      return res.status(400).json({ message: 'Invalid ID.' })
    })
  }
}

module.exports = { defaultEmptyBody, jsonNotFound, validateIdParams }
