/**
 * Integration tests run against a dedicated database whose name must end in
 * `_test`, so a mis-set variable can never point the suite at real data.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://takawise:takawise_dev_password@localhost:5442/takawise_test?schema=public';

export function assertSafeTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run DB tests against "${name}": database name must end with "_test"`,
    );
  }
}

/** A URL that refuses connections immediately (for "database down" tests). */
export const UNREACHABLE_DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/none_test';
