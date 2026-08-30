import type { AppConfig } from './config.js'
import type { DeliveryJob, WebhookDatabase } from './database.js'

export const RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
] as const

interface WorkerOptions {
  database: WebhookDatabase
  config: Pick<AppConfig, 'WORKER_BATCH_SIZE' | 'WORKER_POLL_INTERVAL_MS' | 'WEBHOOK_TIMEOUT_MS'>
  fetchImplementation?: typeof fetch
  now?: () => Date
  random?: () => number
  retryDelaysMs?: readonly number[]
}

export class DeliveryWorker {
  private readonly database: WebhookDatabase
  private readonly config: WorkerOptions['config']
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => Date
  private readonly random: () => number
  private readonly retryDelaysMs: readonly number[]
  private timer: NodeJS.Timeout | undefined
  private running = false

  constructor(options: WorkerOptions) {
    this.database = options.database
    this.config = options.config
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.now = options.now ?? (() => new Date())
    this.random = options.random ?? Math.random
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS
  }

  start(): void {
    if (this.timer) return
    this.database.recoverInterruptedEvents(this.now().toISOString())
    this.timer = setInterval(() => void this.runOnce(), this.config.WORKER_POLL_INTERVAL_MS)
    void this.runOnce()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async runOnce(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const jobs = this.database.claimDueEvents(
        this.config.WORKER_BATCH_SIZE,
        this.now().toISOString(),
      )
      await Promise.allSettled(jobs.map((job) => this.deliver(job)))
    } finally {
      this.running = false
    }
  }

  private async deliver(job: DeliveryJob): Promise<void> {
    const attemptNumber = job.attempt_count + 1
    const attemptedAt = this.now()
    let httpStatus: number | null = null
    let error: string | null = null
    let retryable = false
    let delivered = false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.WEBHOOK_TIMEOUT_MS)
    try {
      const response = await this.fetchImplementation(job.target_url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-event-id': job.id,
          'x-webhook-subscription-id': job.subscription_id,
        },
        body: job.payload_json,
        signal: controller.signal,
      })
      httpStatus = response.status
      delivered = response.status >= 200 && response.status < 300
      retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!delivered) error = `Customer endpoint returned HTTP ${response.status}`
    } catch (caught) {
      retryable = true
      error = controller.signal.aborted
        ? `Customer endpoint timed out after ${this.config.WEBHOOK_TIMEOUT_MS}ms`
        : `Network error: ${caught instanceof Error ? caught.message : String(caught)}`
    } finally {
      clearTimeout(timeout)
    }

    if (delivered) {
      this.database.finishAttempt(job.id, attemptNumber, attemptedAt.toISOString(), {
        outcome: 'delivered',
        httpStatus,
        error: null,
        nextAttemptAt: null,
        deliveredAt: this.now().toISOString(),
      })
      return
    }

    const baseDelay = this.retryDelaysMs[attemptNumber - 1]
    if (retryable && baseDelay !== undefined) {
      const jitterMultiplier = 0.8 + this.random() * 0.4
      const nextAttemptAt = new Date(this.now().getTime() + Math.round(baseDelay * jitterMultiplier))
      this.database.finishAttempt(job.id, attemptNumber, attemptedAt.toISOString(), {
        outcome: 'retry',
        httpStatus,
        error,
        nextAttemptAt: nextAttemptAt.toISOString(),
        deliveredAt: null,
      })
      return
    }

    this.database.finishAttempt(job.id, attemptNumber, attemptedAt.toISOString(), {
      outcome: 'failed',
      httpStatus,
      error,
      nextAttemptAt: null,
      deliveredAt: null,
    })
  }
}
