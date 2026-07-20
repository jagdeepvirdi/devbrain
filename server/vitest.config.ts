import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['tests/**/*.test.ts'],
    env: {
      DATABASE_URL:      'postgresql://test:test@localhost:5432/test',
      JWT_SECRET:        'test-secret-at-least-16-chars!!',
      OLLAMA_URL:        'http://localhost:11434',
      OLLAMA_CHAT_MODEL: 'mistral',
      AI_PROVIDER:       'ollama',
    },
    coverage: {
      provider: 'v8',
      include:  ['lib/**', 'services/**'],
      exclude:  ['services/ldap.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // Baseline from the 2026-07-20 coverage run (39.61/30.12/36.45/41.14%),
        // set a few points below actual so CI gates regressions, not noise.
        statements: 37,
        branches:   28,
        functions:  34,
        lines:      39,
      },
    },
  },
})
