const { Server } = require('socket.io')
const { verifyAuthToken } = require('../utils/jwt')
const { OFFICER_ROLES, HASH_CHAIN_ROLES } = require('../utils/roles')
const prisma = require('../lib/prisma')

let ioInstance = null

// Minimal cookie header parser — avoids pulling in another dependency just
// for this. Handshake headers only ever carry the raw "Cookie" string.
function parseCookieHeader(header = '') {
  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return acc
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key) acc[key] = decodeURIComponent(value)
    return acc
  }, {})
}

// Attaches Socket.IO to the existing HTTP server. Reuses the same
// cookie-based JWT auth as the REST API (see auth.middleware.js) so no new
// auth mechanism is introduced.
function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookieHeader(socket.handshake.headers.cookie)
      const token = cookies['LITL-MIS']
      if (!token) return next(new Error('Unauthorized'))

      const decoded = verifyAuthToken(token)

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, role: true, status: true, tokenVersion: true },
      })
      if (!user || user.tokenVersion !== decoded.tokenVersion || user.status !== 'APPROVED') {
        return next(new Error('Unauthorized'))
      }

      socket.userId = user.id
      socket.role = user.role
      next()
    } catch (err) {
      next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    // Each user gets their own room — notifications are emitted to
    // `user:<id>` so multiple open tabs/devices all update instantly.
    socket.join(`user:${socket.userId}`)

    // Every authenticated user (officer or member) — used for signals that
    // are visible app-wide (event list/status, documents), where the
    // underlying REST endpoint already enforces per-user access on refetch.
    socket.join('all')

    // Officer-only signals (membership, financial, certificates, etc.) —
    // fine-grained per-module permission is still enforced by the REST
    // endpoints when the officer refetches; this room only decides who
    // gets the "something changed" nudge.
    if (OFFICER_ROLES.includes(socket.role)) {
      socket.join('officers')
    }

    // Hash-chain roles — everyone except the Adviser / Dept. Chair, who has
    // no access to that module at all.
    if (HASH_CHAIN_ROLES.includes(socket.role)) {
      socket.join('hash-chain')
    }
  })

  ioInstance = io
  return io
}

function emitToUser(userId, event, payload) {
  if (ioInstance) {
    ioInstance.to(`user:${userId}`).emit(event, payload)
  }
}

function emitToUsers(userIds, event, payload) {
  userIds.forEach((id) => emitToUser(id, event, payload))
}

function emitToAll(event, payload) {
  if (ioInstance) ioInstance.to('all').emit(event, payload)
}

function emitToOfficers(event, payload) {
  if (ioInstance) ioInstance.to('officers').emit(event, payload)
}

function emitToHashChain(event, payload) {
  if (ioInstance) ioInstance.to('hash-chain').emit(event, payload)
}

module.exports = {
  initSocket, emitToUser, emitToUsers, emitToAll, emitToOfficers, emitToHashChain,
}