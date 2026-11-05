// @ts-check
/** SWC transform shared by all projects (decorator metadata is required by Nest DI). */
const transform = {
  '^.+\\.ts$': [
    '@swc/jest',
    {
      swcrc: false,
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'commonjs' },
    },
  ],
};

const shared = {
  testEnvironment: 'node',
  rootDir: __dirname,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform,
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      // Unit tests + HTTP pipeline e2e tests. No database required.
      roots: ['<rootDir>/src', '<rootDir>/test'],
      testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    },
    {
      ...shared,
      displayName: 'db',
      // Integration tests against a real PostgreSQL test database (ADR-015).
      roots: ['<rootDir>/test'],
      testRegex: '.*\\.int-spec\\.ts$',
      // Applies migrations + seed to the test DB once. Each test creates its own
      // users/data, so files can run in parallel without truncation.
      globalSetup: '<rootDir>/test/db/global-setup.ts',
    },
  ],
  // Global (Jest ignores it per project): DB flows register users (Argon2id) and
  // post many entries while files run in parallel.
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/generated/**'],
  coverageDirectory: 'coverage',
};
