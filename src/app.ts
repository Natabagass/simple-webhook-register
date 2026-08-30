import { randomUUID } from 'node:crypto'
import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import type { EventRecord, WebhookDatabase } from './database.js'

const subscriptionSchema = z.object({
  url: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'URL must use http or https'),
}).strict()

const eventSchema = z.object({
  subscriptionId: z.string().min(1),
  payload: z.json(),
}).strict()

interface CreateAppOptions {
  database: WebhookDatabase
  config: AppConfig
  disableRateLimits?: boolean
}

function eventResponse(event: EventRecord) {
  const publicStatus = event.status === 'processing' ? 'pending' : event.status
  return {
    eventId: event.id,
    status: publicStatus,
    attemptCount: event.attempt_count,
    nextAttemptAt: event.next_attempt_at,
    lastError: event.last_error,
    createdAt: event.created_at,
    deliveredAt: event.delivered_at,
    suggestedPollAfterMs: publicStatus === 'pending' ? 2000 : null,
  }
}

function noLimit(): RequestHandler {
  return (_request, _response, next) => next()
}

export function createApp(options: CreateAppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))

  const limiter = (maximum: number) => options.disableRateLimits
    ? noLimit()
    : rateLimit({
        windowMs: options.config.RATE_LIMIT_WINDOW_MS,
        limit: maximum,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_request, response) => response.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Too many requests. Wait before trying again.',
        }),
      })

  const subscriptionLimiter = limiter(options.config.SUBSCRIPTION_RATE_LIMIT_MAX)
  const eventLimiter = limiter(options.config.EVENT_RATE_LIMIT_MAX)
  const statusLimiter = limiter(options.config.STATUS_RATE_LIMIT_MAX)

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.post('/subscriptions', subscriptionLimiter, (request, response) => {
    const input = subscriptionSchema.parse(request.body)
    const subscription = options.database.createSubscription(
      `sub_${randomUUID()}`,
      input.url,
      new Date().toISOString(),
    )
    response.status(201).json({
      id: subscription.id,
      url: subscription.url,
      createdAt: subscription.created_at,
    })
  })

  app.post('/events', eventLimiter, (request, response) => {
    const input = eventSchema.parse(request.body)
    if (!options.database.getSubscription(input.subscriptionId)) {
      response.status(404).json({
        error: 'subscription_not_found',
        message: 'The requested subscription does not exist.',
      })
      return
    }

    const rawIdempotencyKey = request.header('idempotency-key')
    if (rawIdempotencyKey !== undefined && (rawIdempotencyKey.length === 0 || rawIdempotencyKey.length > 200)) {
      response.status(400).json({
        error: 'invalid_idempotency_key',
        message: 'Idempotency-Key must contain between 1 and 200 characters.',
      })
      return
    }

    const result = options.database.createEvent({
      id: `evt_${randomUUID()}`,
      subscriptionId: input.subscriptionId,
      payloadJson: JSON.stringify(input.payload),
      idempotencyKey: rawIdempotencyKey ?? null,
      createdAt: new Date().toISOString(),
    })
    response.status(202).json({
      eventId: result.event.id,
      status: result.event.status === 'processing' ? 'pending' : result.event.status,
      statusUrl: `/events/${result.event.id}`,
      deduplicated: result.deduplicated,
    })
  })

  app.get('/events/:eventId', statusLimiter, (request, response) => {
    const eventId = z.string().parse(request.params.eventId)
    const event = options.database.getEvent(eventId)
    if (!event) {
      response.status(404).json({
        error: 'event_not_found',
        message: 'The requested event does not exist.',
      })
      return
    }
    response.json(eventResponse(event))
  })

  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found', message: 'Route not found.' })
  })

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: 'validation_error',
        message: 'Request body is invalid.',
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
      return
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' })
      return
    }
    console.error(error)
    response.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred.' })
  }
  app.use(errorHandler)

  return app
}
