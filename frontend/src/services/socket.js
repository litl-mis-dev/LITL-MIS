import { io } from 'socket.io-client'

// Uses VITE_SOCKET_URL when set (production/deployment build), otherwise
// falls back to localhost for local development. Same reasoning as api.js —
// this file ships to every client, so it can never hardcode one machine's
// address.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
let socket = null

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, { withCredentials: true, autoConnect: false })
  }
  return socket
}

export function connectSocket() {
  const s = getSocket()
  if (!s.connected) s.connect()
  return s
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect()
}