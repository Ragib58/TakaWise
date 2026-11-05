// @ts-check
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/**
 * Node.js services (NestJS API, libraries).
 * @param {{ tsconfigRootDir: string }} options
 */
export function node({ tsconfigRootDir }) {
  return tseslint.config(...base({ tsconfigRootDir }), {
    languageOptions: {
      globals: { ...globals.node },
    },
  });
}
