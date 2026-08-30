import express from 'express'

const app = express()
const port = Number(process.env.MOCK_CUSTOMER_PORT ?? 4000)
let failuresRemaining = Number(process.env.MOCK_FAILURES_BEFORE_SUCCESS ?? 0)

app.use(express.json())
app.post('/webhook', (request, response) => {
  console.log('Received webhook', {
    eventId: request.header('x-webhook-event-id'),
    subscriptionId: request.header('x-webhook-subscription-id'),
    payload: request.body,
  })
  if (failuresRemaining > 0) {
    failuresRemaining -= 1
    response.status(503).json({ received: false, failuresRemaining })
    return
  }
  response.status(200).json({ received: true })
})

app.listen(port, () => {
  console.log(`Mock customer listening on http://localhost:${port}/webhook`)
})
