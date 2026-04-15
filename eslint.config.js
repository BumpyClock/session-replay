import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import pluginVitest from 'eslint-plugin-vitest'
import { defineConfig, globalIgnores } from 'eslint/config'

const relaxedReactCompilerRules = {
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/set-state-in-effect': 'off',
}

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      vitest: pluginVitest,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      pluginVitest.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: relaxedReactCompilerRules,
  },
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      vitest: pluginVitest,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      pluginVitest.configs.recommended,
    ],
    rules: relaxedReactCompilerRules,
  },
])
