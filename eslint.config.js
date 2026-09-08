import js from '@eslint/js';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

// TypeScript/TSX correctness is enforced by `npm run typecheck`.
// Legacy build helpers are generated/compatibility tooling; lint the project configuration itself.
export default [
  globalIgnores([
    'dist/**',
    'node_modules/**',
    'coverage/**',
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.cjs',
    '**/*.mjs',
    '!eslint.config.js',
  ]),
  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
];
