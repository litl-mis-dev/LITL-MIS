const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

const PURPOSES = {
  EMAIL_VERIFICATION: {
    subject: 'Verify your LITL account',
    heading: 'Verify your email address',
    body:    'Use the code below to complete your registration. It expires in 10 minutes.',
  },
  PASSWORD_RESET: {
    subject: 'Reset your LITL password',
    heading: 'Reset your password',
    body:    'Use the code below to reset your password. It expires in 10 minutes.',
  },
  EMAIL_CHANGE: {
    subject: 'Confirm your new email — LITL',
    heading: 'Confirm your email change',
    body:    'Use the code below to confirm your new email address. It expires in 10 minutes.',
  },
}

const sendOtpEmail = async (toEmail, otp, purpose) => {
  const { subject, heading, body } = PURPOSES[purpose] ?? {
    subject: 'Your LITL verification code',
    heading: 'Verification code',
    body:    'Use the code below. It expires in 10 minutes.',
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">${heading}</h2>
      <p style="color: #444; font-size: 14px;">${body}</p>
      <div style="background: #f4f4f5; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #1a1a1a;">${otp}</span>
      </div>
      <p style="color: #888; font-size: 12px;">
        If you did not request this, you can safely ignore this email.
      </p>
    </div>
  `

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject,
    html,
  })
}

// Membership fee payment reminder — sent to members who are unpaid/have an
// unsettled obligation for the current active semester.
const sendPaymentReminderEmail = async (toEmail, memberName, semesterLabel) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">Membership Payment Reminder</h2>
      <p style="color: #444; font-size: 14px;">
        Hello ${memberName || 'Member'},
      </p>
      <p style="color: #444; font-size: 14px;">
        Our records show that you have an <strong>unpaid / unsettled membership fee</strong>
        for <strong>${semesterLabel}</strong>. Kindly settle your payment at your earliest
        convenience to keep your membership active and in good standing.
      </p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 14px 16px; border-radius: 8px; margin: 20px 0;">
        <span style="font-size: 14px; color: #b91c1c; font-weight: 600;">
          Status: Unpaid for ${semesterLabel}
        </span>
      </div>
      <p style="color: #888; font-size: 12px;">
        If you have already settled this payment, please disregard this email or reach out
        to the organization officers for confirmation.
      </p>
    </div>
  `

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject: `Membership Payment Reminder — ${semesterLabel}`,
    html,
  })
}

const AFFILIATION_LABELS = {
  member: 'LITL Member',
  faculty: 'Faculty / Instructor',
  inside_org: 'Inside Organization',
  outside_org: 'Outside Organization',
}

// Escape untrusted user input before interpolating into the email HTML.
const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Landing page "Contact" form submission — forwarded to the organization
// inbox. Reply-To is set to the sender's own email so officers can reply
// directly from their email client.
const sendContactFormEmail = async ({ name, email, affiliation, organization, subject, message }) => {
  const affiliationLabel = AFFILIATION_LABELS[affiliation] || 'Not specified'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">New Contact Form Message</h2>
      <p style="color: #444; font-size: 14px;">
        <strong>From:</strong> ${escapeHtml(name)} (${escapeHtml(email)})<br/>
        <strong>Affiliation:</strong> ${escapeHtml(affiliationLabel)}${organization ? `<br/><strong>Organization / Department:</strong> ${escapeHtml(organization)}` : ''}
      </p>
      <div style="background: #f4f4f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #1a1a1a;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <p style="margin: 0; font-size: 14px; color: #444; white-space: pre-wrap;">${escapeHtml(message)}</p>
      </div>
      <p style="color: #888; font-size: 12px;">
        Sent via the LITL MIS public contact form. Reply directly to this email to respond to ${escapeHtml(name)}.
      </p>
    </div>
  `

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.ORGANIZATION_EMAIL || process.env.EMAIL_FROM,
    replyTo: email,
    subject: `[Contact Form] ${subject}`,
    html,
  })
}

// Registration decision — sent to the student right after an officer approves
// or rejects their registration. Students can't log in while pending/rejected,
// so they never subscribe to push; email is the one channel that always reaches them.
const sendRegistrationStatusEmail = async (toEmail, memberName, approved) => {
  const name = escapeHtml(memberName || 'Student')
  const loginUrl = `${(process.env.FRONTEND_URL || '').replace(/\/$/, '')}/login`

  const html = approved
    ? `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">Registration Approved</h2>
      <p style="color: #444; font-size: 14px;">Hello ${name},</p>
      <p style="color: #444; font-size: 14px;">
        Congratulations! Your LITL membership registration has been <strong>approved</strong>
        and your account is now active. You can sign in using your email and password.
      </p>
      <p style="margin: 24px 0;">
        <a href="${loginUrl}" style="background: #1a1a1a; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">Sign in</a>
      </p>
    </div>
  `
    : `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a;">Registration Not Approved</h2>
      <p style="color: #444; font-size: 14px;">Hello ${name},</p>
      <p style="color: #444; font-size: 14px;">
        We're sorry, but your LITL membership registration was <strong>not approved</strong>.
        Please contact an officer for further assistance.
      </p>
    </div>
  `

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject: approved ? 'Your LITL registration was approved' : 'Update on your LITL registration',
    html,
  })
}

module.exports = { sendOtpEmail, sendPaymentReminderEmail, sendContactFormEmail, sendRegistrationStatusEmail }