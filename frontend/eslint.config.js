import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    rules: {
      // Pages load their data in an effect when they open (setLoading(true),
      // fetch, set the result). That is the intended pattern here, and this
      // rule flags every such effect.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Route files declare lazy-loaded pages, and context files export a hook
  // next to their provider. This rule only affects hot reload in development.
  {
    files: ['src/routes/**/*.{js,jsx}', 'src/context/**/*.{js,jsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  // The service worker runs in its own global scope (self, clients).
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  // Build config runs in Node.
  {
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
])
