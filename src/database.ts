import Database from 'better-sqlite3'

export type EventStatus = 'pending' | 'processing' | 'delivered' | 'failed'

export interface SubscriptionRecord {
  id: string
  url: string
  created_at: string
}

export interface EventRecord {
  id: string
  subscription_id: string
  payload_json: string
  status: EventStatus
  attempt_count: number
  next_attempt_at: string | null
  last_error: string | null
  idempotency_key: string | null
  created_at: string
  delivered_at: string | null
}

export interface DeliveryJob extends EventRecord {
  target_url: string
}

export interface AttemptResult {
  outcome: 'delivered' | 'retry' | 'failed'
  httpStatus: number | null
  error: string | null
  nextAttemptAt: string | null
  deliveredAt: string | null
}

export class WebhookDatabase {
  private readonly connection: Database.Database

  constructor(path: string) {
    this.connection = new Database(path)
    this.connection.pragma('journal_mode = WAL')
    this.connection.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        UNIQUE (subscription_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS delivery_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL REFERENCES events(id),
        attempt_number INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('delivered', 'retry', 'failed')),
        http_status INTEGER,
        error TEXT,
        attempted_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_due
        ON events(status, next_attempt_at, created_at);
    `)
  }

  close(): void {
    this.connection.close()
  }

  createSubscription(id: string, url: string, createdAt: string): SubscriptionRecord {
    this.connection.prepare(
      'INSERT INTO subscriptions (id, url, created_at) VALUES (?, ?, ?)',
    ).run(id, url, createdAt)
    return { id, url, created_at: createdAt }
  }

  getSubscription(id: string): SubscriptionRecord | undefined {
    return this.connection.prepare(
      'SELECT id, url, created_at FROM subscriptions WHERE id = ?',
    ).get(id) as SubscriptionRecord | undefined
  }

  createEvent(input: {
    id: string
    subscriptionId: string
    payloadJson: string
    idempotencyKey: string | null
    createdAt: string
  }): { event: EventRecord; deduplicated: boolean } {
    const operation = this.connection.transaction(() => {
      if (input.idempotencyKey) {
        const existing = this.connection.prepare(`
          SELECT * FROM events WHERE subscription_id = ? AND idempotency_key = ?
        `).get(input.subscriptionId, input.idempotencyKey) as EventRecord | undefined
        if (existing) return { event: existing, deduplicated: true }
      }

      this.connection.prepare(`
        INSERT INTO events (
          id, subscription_id, payload_json, status, attempt_count,
          next_attempt_at, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
      `).run(
        input.id,
        input.subscriptionId,
        input.payloadJson,
        input.createdAt,
        input.idempotencyKey,
        input.createdAt,
      )
      return { event: this.getEvent(input.id)!, deduplicated: false }
    })
    return operation()
  }

  getEvent(id: string): EventRecord | undefined {
    return this.connection.prepare('SELECT * FROM events WHERE id = ?').get(id) as
      | EventRecord
      | undefined
  }

  getAttempts(eventId: string): Array<Record<string, unknown>> {
    return this.connection.prepare(`
      SELECT attempt_number, outcome, http_status, error, attempted_at
      FROM delivery_attempts WHERE event_id = ? ORDER BY attempt_number
    `).all(eventId) as Array<Record<string, unknown>>
  }

  recoverInterruptedEvents(now: string): number {
    return this.connection.prepare(`
      UPDATE events
      SET status = 'pending', next_attempt_at = ?, last_error = 'Worker interrupted; delivery will be retried'
      WHERE status = 'processing'
    `).run(now).changes
  }

  claimDueEvents(limit: number, now: string): DeliveryJob[] {
    const claim = this.connection.transaction(() => {
      const rows = this.connection.prepare(`
        SELECT e.*, s.url AS target_url
        FROM events e
        JOIN subscriptions s ON s.id = e.subscription_id
        WHERE e.status = 'pending' AND e.next_attempt_at <= ?
        ORDER BY e.next_attempt_at, e.created_at
        LIMIT ?
      `).all(now, limit) as DeliveryJob[]

      const markProcessing = this.connection.prepare(
        "UPDATE events SET status = 'processing' WHERE id = ? AND status = 'pending'",
      )
      return rows.filter((row) => markProcessing.run(row.id).changes === 1)
    })
    return claim()
  }

  finishAttempt(eventId: string, attemptNumber: number, attemptedAt: string, result: AttemptResult): void {
    const finish = this.connection.transaction(() => {
      this.connection.prepare(`
        INSERT INTO delivery_attempts (
          event_id, attempt_number, outcome, http_status, error, attempted_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId, attemptNumber, result.outcome, result.httpStatus, result.error, attemptedAt)

      const status: EventStatus = result.outcome === 'retry' ? 'pending' : result.outcome
      this.connection.prepare(`
        UPDATE events
        SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, delivered_at = ?
        WHERE id = ?
      `).run(status, attemptNumber, result.nextAttemptAt, result.error, result.deliveredAt, eventId)
    })
    finish()
  }
}
