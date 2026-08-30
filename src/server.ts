import 'dotenv/config'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { WebhookDatabase } from './database.js'
import { DeliveryWorker } from './worker.js'

const config = loadConfig()
const database = new WebhookDatabase(config.DATABASE_PATH)
const worker = new DeliveryWorker({ database, config })
const app = createApp({ database, config })

const server = app.listen(config.PORT, () => {
  console.log(`Webhook delivery service listening on http://localhost:${config.PORT}`)
  worker.start()
})

function shutdown(): void {
  console.log('Shutting down webhook delivery service')
  worker.stop()
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
