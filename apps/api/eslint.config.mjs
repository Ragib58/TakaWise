import { node } from '@takawise/eslint-config/node';

export default [
  ...node({ tsconfigRootDir: import.meta.dirname }),
  {
    // ADR-003: money is Decimal end-to-end in financial code. JS numbers lose precision.
    files: ['src/domain/**/*.ts', 'src/modules/{ledger,accounts,transactions,idempotency}/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use parseMoney() (Decimal) for money (ADR-003).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='Number']",
          message: 'Do not convert money to a JS number; use Decimal helpers (ADR-003).',
        },
        {
          selector: "CallExpression[callee.property.name='toNumber']",
          message: 'Do not convert Decimal to a JS number (ADR-003).',
        },
        {
          selector: "CallExpression[callee.object.name='Math']",
          message: 'Math.* works on floats; use Decimal methods for money (ADR-003).',
        },
      ],
    },
  },
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
