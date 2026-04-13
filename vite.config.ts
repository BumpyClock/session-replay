import { fileURLToPath } from 'node:url'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { managedApiPlugin } from './scripts/vite-managed-api'

const apiBaseUrl = process.env.SESSION_REPLAY_API_URL ?? 'http://127.0.0.1:4848'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiBaseUrl,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    managedApiPlugin(apiBaseUrl),
  ],
})
