import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: dependencyStatusSchema,
  }),
  timestamp: z.iso.datetime(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
