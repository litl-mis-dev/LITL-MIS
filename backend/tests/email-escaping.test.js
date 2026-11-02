// SEC-09: values interpolated into the payment reminder email are HTML-escaped.
// Run with: npm test
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const sent = []
const nodemailer = require('nodemailer')
nodemailer.createTransport = () => ({ sendMail: async (m) => { sent.push(m) } })
const { sendPaymentReminderEmail } = require(path.join(__dirname, '..', 'src', 'utils', 'email'))

test('reminder email escapes the member name and semester label', async () => {
  await sendPaymentReminderEmail('m@cvsu.edu.ph', '<b>Juan</b> & Co', '1st <i>Sem</i>')
  const { html } = sent[0]
  assert.ok(html.includes('&lt;b&gt;Juan&lt;/b&gt; &amp; Co'))
  assert.ok(html.includes('1st &lt;i&gt;Sem&lt;/i&gt;'))
  assert.ok(!html.includes('<b>Juan</b>'))
  assert.ok(!html.includes('<i>Sem</i>'))
})
