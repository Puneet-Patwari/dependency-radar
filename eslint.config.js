// eslint.config.js format (ESLint 9+ flat config, also supported in ESLint 8 with ESLINT_USE_FLAT_CONFIG=true)
import js from '@eslint/js';
import tsEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// Load vendored Forge ESLint plugin
let forgePlugin;
try {
  forgePlugin = (await import('./.eslint/forge-plugin/dist/index.js')).default;
} catch {
  console.warn('Forge ESLint plugin not found - run yarn sync:eslint-plugin');
}

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        JSX: 'readonly',
        // Web API globals
        globalThis: 'readonly',
        Headers: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        // Node globals
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
      react: react,
      'react-hooks': reactHooks,
      ...(forgePlugin ? { forge: forgePlugin } : {}),
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // Basic recommended rules
      ...js.configs.recommended.rules,
      ...tsEslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Custom rule overrides
      'react/react-in-jsx-scope': 'off', // Not needed with React 17+ JSX transform
      'no-unused-vars': 'off', // Turn off base rule
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Forge UI Kit structural rules (enabled if plugin available)
      ...(forgePlugin
        ? {
            'forge/no-empty-components': 'error',
            'forge/checkbox-group-structure': 'error',
            'forge/tabs-structure': 'error',
            'forge/no-form-label-prop': 'error',
            'forge/no-heading-level-prop': 'error',
            'forge/no-html-elements': 'error',
            'forge/require-forge-reconciler': 'error',
            'forge/no-double-encode-route': 'error',
            'forge/no-toggle-is-checked': 'error',
            'forge/require-allow-impersonation': 'error',
          }
        : {}),
    },
  },
];
