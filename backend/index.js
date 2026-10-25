require('dotenv').config()
const validateEnv = require('./src/utils/validateEnv')
validateEnv()

const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const helmet = require('helmet')
const morgan = require('morgan')
const fs = require('fs')
const path = require('path')

const authRoutes = require('./src/routes/auth.routes')
const officerRoutes = require('./src/routes/officer.routes')
const financialRoutes = require('./src/routes/financial.routes')
const auditLogRoutes  = require('./src/routes/auditLog.routes')
const { startCleanupJob } = require('./src/utils/cleanup')
const eventRoutes = require('./src/routes/event.routes')
const documentRoutes = require('./src/routes/document.routes')
const dashboardRoutes = require('./src/routes/dashboard.routes')
const ledgerRoutes = require('./src/routes/ledger.routes')
const rolePermissionRoutes = require('./src/routes/rolePermission.routes')
const documentAssetRoutes = require('./src/routes/documentAsset.routes')
const certificationRoutes = require('./src/routes/certification.routes')
const notificationRoutes = require('./src/routes/notification.routes')
const announcementRoutes = require('./src/routes/announcement.routes')
const contactRoutes = require('./src/routes/contact.routes')
const http = require('http')
const { initSocket } = require('./src/realtime/socket')
const prisma = require('./src/lib/prisma')

const app = express()

const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '0')
if (trustProxy !== '0' && trustProxy !== 'false') {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
}

const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173'

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-ancestors': ["'self'", FRONTEND_ORIGIN],
    },
  },
}))

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// FRONTEND_URL must be set in .env for both dev and production.
// Never use a wildcard origin when credentials: true is set — browsers reject it,
// and it would be unsafe even if they didn't.
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['Content-Disposition']
}))

app.use('/api/auth/avatar', express.json({ limit: '3mb' }))
app.use(express.json())
app.use(cookieParser())

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next()
  const origin = req.headers.origin
  if (origin && origin.replace(/\/$/, '') !== FRONTEND_ORIGIN.replace(/\/$/, '')) {
    return res.status(403).json({ message: 'Origin not allowed' })
  }
  next()
})

app.use('/api/auth', authRoutes)
app.use('/api/officer', officerRoutes)
app.use('/api/financial', financialRoutes)
app.use('/api/audit-logs', auditLogRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/ledger', ledgerRoutes)
app.use('/api/role-permissions', rolePermissionRoutes)
app.use('/api/document-assets', documentAssetRoutes)
app.use('/api/certification', certificationRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/announcements', announcementRoutes)
app.use('/api/contact', contactRoutes)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ready' })
  } catch (err) {
    res.status(503).json({ status: 'unavailable' })
  }
})

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Not found' })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body is too large.' })
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body.' })
  console.error('[ERROR] Unhandled request error:', err.message || err)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
})

const PORT = process.env.PORT || 5000

const server = http.createServer(app)
initSocket(server)

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  startCleanupJob()
})  

process.on('unhandledRejection', (reason) => {
  console.error('[ERROR] Unhandled promise rejection:', reason instanceof Error ? reason.message : reason)
})

let shuttingDown = false
const shutdown = (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received — shutting down gracefully`)
  const force = setTimeout(() => process.exit(1), 10000)
  force.unref()
  server.close(async () => {
    try { await prisma.$disconnect() } catch { /* ignore */ }
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))