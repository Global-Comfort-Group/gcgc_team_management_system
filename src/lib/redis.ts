import { createClient, RedisClientType } from 'redis'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

let redisClient: RedisClientType | null = null
let isConnecting = false

/**
 * When Redis is absent, remember that for a while instead of re-probing.
 *
 * Every task assignment publishes a notification, so without this a deployment
 * running no Redis paid a fresh TCP connect — and its timeout — on the critical
 * path of every assign and transfer. That latency showed up to users as the
 * assignment itself being slow. Redis is optional here (Socket.IO falls back to
 * single-instance mode), so a miss must be cheap.
 */
const UNAVAILABLE_BACKOFF_MS = 30_000
let unavailableUntil = 0

/** Connecting must not hang the request that triggered it. */
const CONNECT_TIMEOUT_MS = 1_000

/**
 * Get a shared Redis client for publishing events. Returns null when Redis is
 * unavailable — callers are expected to degrade, not fail.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient?.isOpen) {
    return redisClient
  }

  if (Date.now() < unavailableUntil) {
    return null
  }

  if (isConnecting) {
    // Wait for existing connection attempt
    await new Promise(resolve => setTimeout(resolve, 100))
    return redisClient
  }

  try {
    isConnecting = true
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        // Give up rather than retrying forever behind the caller's back; the
        // backoff above decides when it is worth trying again.
        reconnectStrategy: false,
      },
    })

    redisClient.on('error', (err) => {
      console.error('Redis client error:', err)
    })

    await redisClient.connect()
    console.log('Redis client connected for notifications')
    isConnecting = false
    unavailableUntil = 0
    return redisClient
  } catch (error) {
    console.warn('Redis not available for notifications:', error)
    isConnecting = false
    redisClient = null
    unavailableUntil = Date.now() + UNAVAILABLE_BACKOFF_MS
    return null
  }
}

/**
 * Publish a notification event to Redis for Socket.IO to emit
 */
export async function publishNotification(userId: string, notification: object) {
  try {
    const client = await getRedisClient()
    if (client) {
      await client.publish('notifications', JSON.stringify({
        userId,
        notification,
        timestamp: new Date().toISOString(),
      }))
      console.log(`Published notification to Redis for user-${userId}`)
      return true
    }
    return false
  } catch (error) {
    console.error('Error publishing notification to Redis:', error)
    return false
  }
}
