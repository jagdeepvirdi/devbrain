import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@':       path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    globals:     true,
    environment: 'jsdom',
    include:     ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles:  ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include:  ['src/**'],
      exclude:  ['src/test/**', 'src/main.tsx'],
      reporter: ['text', 'lcov'],
    },
  },
})
