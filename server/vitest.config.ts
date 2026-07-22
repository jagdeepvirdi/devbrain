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
      include:  ['lib/**', 'services/**', 'routes/**'],
      exclude:  ['services/ldap.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // Re-baselined 2026-07-22 after adding routes/** to include (98.46/95.78/96.29/99.51%),
        // set a few points below actual so CI gates regressions, not noise.
        statements: 96,
        branches:   93,
        functions:  94,
        lines:      97,
      },
    },
  },
})
