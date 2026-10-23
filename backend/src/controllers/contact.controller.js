const { logError } = require('../utils/logger')
const { sendContactFormEmail } = require('../utils/email')

const VALID_AFFILIATIONS = ['member', 'faculty', 'inside_org', 'outside_org']
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /api/contact — public landing-page contact form. No auth: anyone
// visiting the site can reach this, so keep validation strict and rely on
// contactFormLimiter (route-level) to guard against abuse.
const submitContactForm = async (req, res) => {
  try {
    const { name, email, affiliation, organization, subject, message } = req.body

    const errors = {}

    if (!name?.trim()) {
      errors.name = 'Name is required.'
    } else if (name.trim().length < 2 || name.trim().length > 100) {
      errors.name = 'Name must be 2–100 characters.'
    }

    if (!email?.trim()) {
      errors.email = 'Email is required.'
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = 'Enter a valid email address.'
    }

    if (affiliation && !VALID_AFFILIATIONS.includes(affiliation)) {
      errors.affiliation = 'Invalid affiliation.'
    }

    if (organization && organization.trim().length > 100) {
      errors.organization = 'Must not exceed 100 characters.'
    }

    if (!subject?.trim()) {
      errors.subject = 'Subject is required.'
    } else if (subject.trim().length < 3 || subject.trim().length > 150) {
      errors.subject = 'Subject must be 3–150 characters.'
    }

    if (!message?.trim()) {
      errors.message = 'Message is required.'
    } else if (message.trim().length < 10) {
      errors.message = 'Message must be at least 10 characters.'
    } else if (message.trim().length > 2000) {
      errors.message = 'Message must not exceed 2000 characters.'
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ message: 'Validation failed.', errors })
    }

    await sendContactFormEmail({
      name: name.trim(),
      email: email.trim(),
      affiliation: affiliation || 'member',
      organization: organization?.trim() || '',
      subject: subject.trim(),
      message: message.trim(),
    })

    return res.status(200).json({ message: 'Message sent successfully.' })
  } catch (err) {
    logError('Submit contact form', err)
    return res.status(500).json({ message: 'Failed to send your message. Please try again later.' })
  }
}

module.exports = { submitContactForm }