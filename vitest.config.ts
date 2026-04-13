import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx,cts,mts}',
      'test/**/*.{test,spec}.{js,jsx,ts,tsx,cts,mts}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    css: true,
    passWithNoTests: true,
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
