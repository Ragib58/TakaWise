// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Base TakaWise config: type-aware TypeScript rules + Prettier compatibility.
 * @param {{ tsconfigRootDir: string }} options
 */
export function base({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/node_modules/**',
        'next-env.d.ts',
        '**/src/generated/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        eqeqeq: ['error', 'always'],
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}

/**
 * For code that ships to the browser or is shared with it (apps/web,
 * packages/contracts): database entities and server-only packages must never be
 * imported (blueprint Phase 2: "Never expose Prisma entities to browser").
 */
export const forbidServerOnlyImports = {
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@prisma/*', 'prisma', '**/generated/prisma', '**/generated/prisma/**'],
            message: 'Prisma is server-only. Use @takawise/contracts schemas/types instead.',
          },
          {
            group: ['@takawise/api', '@takawise/api/*'],
            message: 'Import shared types from @takawise/contracts, never from the API app.',
          },
        ],
      },
    ],
  },
};
