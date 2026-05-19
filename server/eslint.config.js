import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'tests/**', 'node_modules/**', 'public/**'] },
  {
    extends: [...tseslint.configs.recommended],
    files:   ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any':  'error',
      '@typescript-eslint/no-unused-vars':   ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  prettier,
)
