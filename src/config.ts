import { z } from 'zod'

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/webhooks.db'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  SUBSCRIPTION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  EVENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  STATUS_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
})

export type AppConfig = z.infer<typeof environmentSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) {
    throw new Error(`Invalid configuration: ${z.prettifyError(result.error)}`)
  }
  return result.data
}
