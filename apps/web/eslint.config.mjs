import { base, forbidServerOnlyImports } from '@takawise/eslint-config/base';
import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  ...base({ tsconfigRootDir: import.meta.dirname }),
  forbidServerOnlyImports,
  {
    settings: { next: { rootDir: import.meta.dirname } },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];

export default config;
