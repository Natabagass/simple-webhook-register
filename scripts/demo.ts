import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as wait } from 'node:timers/promises'
import express from 'express'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { WebhookDatabase } from '../src/database.js'
import { DeliveryWorker } from '../src/worker.js'

function listen(app: ReturnType<typeof express>): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
    server.on('error', reject)
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function baseUrl(server: Server): string {
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body, retryAfter: response.headers.get('retry-after') }
}

const database = new WebhookDatabase(':memory:')
let mockServer: Server | undefined
let serviceServer: Server | undefined

try {
  console.log('\nWebhook delivery demo (accelerated retry)')
  console.log('=========================================')

  let mockCalls = 0
  const mockCustomer = express()
  mockCustomer.use(express.json())
  mockCustomer.post('/webhook', (request, response) => {
    mockCalls += 1
    console.log(`Customer received attempt ${mockCalls}:`, request.body)
    if (mockCalls === 1) {
      response.status(503).json({ message: 'Temporary outage for demo' })
      return
    }
    response.status(204).end()
  })
  mockServer = await listen(mockCustomer)

  const config = {
    ...loadConfig({}),
    EVENT_RATE_LIMIT_MAX: 2,
    RATE_LIMIT_WINDOW_MS: 60_000,
  }
  const app = createApp({ database, config })
  serviceServer = await listen(app)
  const serviceUrl = baseUrl(serviceServer)
  const customerUrl = `${baseUrl(mockServer)}/webhook`
  const worker = new DeliveryWorker({
    database,
    config,
    retryDelaysMs: [100],
    random: () => 0.5,
  })

  const health = await jsonRequest(`${serviceUrl}/health`)
  console.log(`\n1. Health check: HTTP ${health.status}`, health.body)

  const subscription = await jsonRequest(`${serviceUrl}/subscriptions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: customerUrl }),
  })
  const subscriptionId = String(subscription.body.id)
  console.log(`2. Register subscription: HTTP ${subscription.status}`, { subscriptionId })

  const eventPayload = {
    subscriptionId,
    payload: { type: 'order.paid', orderId: 'demo-order-123' },
  }
  const firstEvent = await jsonRequest(`${serviceUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'demo-request-1' },
    body: JSON.stringify(eventPayload),
  })
  const eventId = String(firstEvent.body.eventId)
  console.log(`3. Accept event: HTTP ${firstEvent.status}`, firstEvent.body)

  await worker.runOnce()
  const afterFailure = await jsonRequest(`${serviceUrl}/events/${eventId}`)
  console.log('4. First delivery returns 503:', afterFailure.body)

  await wait(120)
  await worker.runOnce()
  const afterRetry = await jsonRequest(`${serviceUrl}/events/${eventId}`)
  console.log('5. Accelerated retry returns 204:', afterRetry.body)

  const duplicate = await jsonRequest(`${serviceUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'demo-request-1' },
    body: JSON.stringify(eventPayload),
  })
  console.log(`6. Repeat producer request: HTTP ${duplicate.status}`, duplicate.body)

  const limited = await jsonRequest(`${serviceUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...eventPayload, payload: { type: 'another.event' } }),
  })
  console.log(`7. Third ingestion request: HTTP ${limited.status}`, {
    ...limited.body,
    retryAfter: limited.retryAfter,
  })

  console.log('\nFinal result')
  console.log('============')
  console.log({
    deliveryStatus: afterRetry.body.status,
    deliveryAttempts: afterRetry.body.attemptCount,
    sameEventReturned: duplicate.body.eventId === eventId,
    duplicateDetected: duplicate.body.deduplicated,
    rateLimitStatus: limited.status,
    retryAfter: limited.retryAfter,
  })
  console.log('\nDemo passed: retry, delivery, idempotency, and rate limiting are working.')
} finally {
  if (serviceServer) await close(serviceServer)
  if (mockServer) await close(mockServer)
  database.close()
}
