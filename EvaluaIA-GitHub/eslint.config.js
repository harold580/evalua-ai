import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'VERCEL-READY-EVALUA-AI', 'evalua-pruebas-updates', 'qa', '.npm-cache', 'public/libarchive']),
  {
    files: ['**/*.{js,mjs,jsx}'],
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
    files: ['api/**/*.js', 'server.js', 'tests/**/*.{js,mjs}', 'vite.config.js', '*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
