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
      USE_CLAUDE:        'false',
    },
    coverage: {
      provider: 'v8',
      include:  ['lib/**', 'services/**'],
      exclude:  ['services/ldap.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
