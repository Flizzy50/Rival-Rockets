import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/', 'dist-server/', 'node_modules/', '.agents/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.ts', 'vite.config.ts', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Display names and all other text must render as plain text, never as HTML.
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent; never render HTML strings.' },
        { property: 'outerHTML', message: 'Use textContent; never render HTML strings.' },
        { property: 'insertAdjacentHTML', message: 'Build nodes and set textContent instead.' },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
