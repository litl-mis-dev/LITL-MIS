import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const bad = (value) => !value || /localhost|127\.0\.0\.1/i.test(value)
    if (bad(env.VITE_API_URL) || bad(env.VITE_SOCKET_URL)) {
      throw new Error(
        'Production build blocked: VITE_API_URL and VITE_SOCKET_URL must be set to the deployed API (not localhost).'
      )
    }
  }

  return { plugins: [react(), tailwindcss()] }
})