import tseslint      from 'typescript-eslint'
import react          from 'eslint-plugin-react'
import reactHooks     from 'eslint-plugin-react-hooks'
import reactRefresh   from 'eslint-plugin-react-refresh'
import prettier       from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'src/test/**', 'node_modules/**'] },
  {
    extends: [...tseslint.configs.recommended],
    files:   ['**/*.ts', '**/*.tsx'],
    plugins: {
      react,
      'react-hooks':    reactHooks,
      'react-refresh':  reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler readiness rules — not actionable today since this app doesn't build with
      // React Compiler (no babel-plugin-react-compiler). Downgraded to warnings so they stay visible
      // without failing `npm run lint`; revisit as errors if/when React Compiler is adopted.
      'react-hooks/set-state-in-effect':          'warn',
      'react-hooks/refs':                         'warn',
      'react-hooks/purity':                       'warn',
      'react-hooks/preserve-manual-memoization':  'warn',
      '@typescript-eslint/no-explicit-any':  'error',
      '@typescript-eslint/no-unused-vars':   ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/jsx-key':                       'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  prettier,
)
