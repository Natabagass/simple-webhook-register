import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { WebhookDatabase } from '../src/database.js'
import { DeliveryWorker } from '../src/worker.js'

const openDatabases: WebhookDatabase[] = []

function setup(fetchImplementation: typeof fetch, retryDelaysMs: readonly number[] = [1000]) {
  const database = new WebhookDatabase(':memory:')
  openDatabases.push(database)
  let currentTime = new Date('2026-01-01T00:00:00.000Z')
  const subscription = database.createSubscription('sub_test', 'https://customer.test/webhook', currentTime.toISOString())
  const event = database.createEvent({
    id: 'evt_test',
    subscriptionId: subscription.id,
    payloadJson: JSON.stringify({ hello: 'world' }),
    idempotencyKey: null,
    createdAt: currentTime.toISOString(),
  }).event
  const config = { ...loadConfig({}), WEBHOOK_TIMEOUT_MS: 20 }
  const worker = new DeliveryWorker({
    database,
    config,
    fetchImplementation,
    retryDelaysMs,
    random: () => 0.5,
    now: () => currentTime,
  })
  return {
    database,
    event,
    worker,
    advance(ms: number) { currentTime = new Date(currentTime.getTime() + ms) },
  }
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('delivery worker', () => {
  it('delivers a pending event and sends stable identifying headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const { database, worker } = setup(fetchMock)

    await worker.runOnce()

    expect(database.getEvent('evt_test')).toMatchObject({ status: 'delivered', attempt_count: 1 })
    expect(fetchMock).toHaveBeenCalledWith('https://customer.test/webhook', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-webhook-event-id': 'evt_test' }),
      body: JSON.stringify({ hello: 'world' }),
    }))
  })

  it('retries a temporary failure and can later succeed', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const { database, worker, advance } = setup(fetchMock)

    await worker.runOnce()
    expect(database.getEvent('evt_test')).toMatchObject({ status: 'pending', attempt_count: 1 })

    advance(1000)
    await worker.runOnce()
    expect(database.getEvent('evt_test')).toMatchObject({ status: 'delivered', attempt_count: 2 })
    expect(database.getAttempts('evt_test')).toHaveLength(2)
  })

  it('fails immediately for a permanent 4xx response', async () => {
    const { database, worker } = setup(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 400 })),
    )

    await worker.runOnce()

    expect(database.getEvent('evt_test')).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      last_error: 'Customer endpoint returned HTTP 400',
    })
  })

  it('marks an event failed when retry attempts are exhausted', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }))
    const { database, worker, advance } = setup(fetchMock, [1000])

    await worker.runOnce()
    advance(1000)
    await worker.runOnce()

    expect(database.getEvent('evt_test')).toMatchObject({ status: 'failed', attempt_count: 2 })
  })

  it('recovers processing events after an interrupted worker', () => {
    const { database } = setup(vi.fn<typeof fetch>())
    const jobs = database.claimDueEvents(1, '2026-01-01T00:00:00.000Z')
    expect(jobs).toHaveLength(1)

    const recovered = database.recoverInterruptedEvents('2026-01-01T00:01:00.000Z')

    expect(recovered).toBe(1)
    expect(database.getEvent('evt_test')).toMatchObject({ status: 'pending' })
  })
})
