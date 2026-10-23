const { verifyLedger } = require('../utils/ledger')
const { logError } = require('../utils/logger')

const verify = async (req, res) => {
  try {
    const result = await verifyLedger()
    return res.json(result)
  } catch (err) {
    logError('Verify ledger', err)
    return res.status(500).json({ message: 'Something went wrong during ledger verification.' })
  }
}

module.exports = { verify }