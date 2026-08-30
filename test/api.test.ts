import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { WebhookDatabase } from '../src/database.js'

const openDatabases: WebhookDatabase[] = []

function setup(disableRateLimits = true, eventRateLimit = 100) {
  const database = new WebhookDatabase(':memory:')
  openDatabases.push(database)
  const config = {
    ...loadConfig({}),
    EVENT_RATE_LIMIT_MAX: eventRateLimit,
  }
  return { database, app: createApp({ database, config, disableRateLimits }) }
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('webhook API', () => {
  it('registers a subscription, accepts an event, and exposes its status', async () => {
    const { app } = setup()
    const subscription = await request(app)
      .post('/subscriptions')
      .send({ url: 'http://localhost:4000/webhook' })
      .expect(201)

    const accepted = await request(app)
      .post('/events')
      .send({ subscriptionId: subscription.body.id, payload: { orderId: 'order-123' } })
      .expect(202)

    expect(accepted.body).toMatchObject({ status: 'pending', deduplicated: false })
    expect(accepted.body.eventId).toMatch(/^evt_/)

    const status = await request(app).get(accepted.body.statusUrl).expect(200)
    expect(status.body).toMatchObject({
      eventId: accepted.body.eventId,
      status: 'pending',
      attemptCount: 0,
      suggestedPollAfterMs: 2000,
    })
  })

  it('validates URLs and rejects unknown subscriptions', async () => {
    const { app } = setup()
    const invalid = await request(app).post('/subscriptions').send({ url: 'ftp://example.com' }).expect(400)
    expect(invalid.body.error).toBe('validation_error')

    const missing = await request(app)
      .post('/events')
      .send({ subscriptionId: 'sub_missing', payload: { hello: 'world' } })
      .expect(404)
    expect(missing.body.error).toBe('subscription_not_found')
  })

  it('deduplicates producer retries with an idempotency key', async () => {
    const { app } = setup()
    const subscription = await request(app)
      .post('/subscriptions')
      .send({ url: 'https://example.com/webhook' })

    const eventBody = { subscriptionId: subscription.body.id, payload: { value: 42 } }
    const first = await request(app).post('/events').set('Idempotency-Key', 'producer-request-1').send(eventBody)
    const second = await request(app).post('/events').set('Idempotency-Key', 'producer-request-1').send(eventBody)

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(second.body).toMatchObject({ eventId: first.body.eventId, deduplicated: true })
  })

  it('limits event ingestion independently', async () => {
    const { app } = setup(false, 1)
    const subscription = await request(app)
      .post('/subscriptions')
      .send({ url: 'https://example.com/webhook' })

    const body = { subscriptionId: subscription.body.id, payload: { value: 1 } }
    await request(app).post('/events').send(body).expect(202)
    const limited = await request(app).post('/events').send(body).expect(429)

    expect(limited.body.error).toBe('rate_limit_exceeded')
    expect(limited.headers['retry-after']).toBeDefined()
    await request(app).get('/health').expect(200)
  })
})
