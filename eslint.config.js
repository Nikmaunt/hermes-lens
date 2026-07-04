import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'android', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // The settings token must never be logged; keep console usage deliberate.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Context providers intentionally co-locate their hook with the component.
    files: ['**/*Provider.tsx', '**/LockGate.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
