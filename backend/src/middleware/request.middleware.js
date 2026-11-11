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

module.exports = { defaultEmptyBody, jsonNotFound }
