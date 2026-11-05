import { node } from '@takawise/eslint-config/node';

export default [
  ...node({ tsconfigRootDir: import.meta.dirname }),
  {
    // Tests inspect untyped supertest bodies; keep the rest of the type-aware rules.
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
