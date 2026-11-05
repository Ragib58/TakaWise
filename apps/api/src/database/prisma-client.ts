import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export type PrismaClientOptions = {
  connectionString: string;
  /** Max pool size per process. */
  maxConnections?: number;
};

/** Single place that constructs Prisma clients (Prisma 7 requires a driver adapter). */
export function createPrismaClient({
  connectionString,
  maxConnections = 10,
}: PrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: maxConnections });
  return new PrismaClient({ adapter });
}
