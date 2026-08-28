const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')
const { createClient } = require('redis')
const { createAdapter } = require('@socket.io/redis-adapter')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(async () => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXTAUTH_URL || `http://localhost:${port}`,
      methods: ['GET', 'POST']
    }
  })

  // Set up Redis adapter for Socket.IO (required for PM2 cluster mode)
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
  try {
    const pubClient = createClient({ url: redisUrl })
    const subClient = pubClient.duplicate()
    const notificationSubClient = pubClient.duplicate()
    const taskEventSubClient = pubClient.duplicate()

    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
      notificationSubClient.connect(),
      taskEventSubClient.connect()
    ])

    io.adapter(createAdapter(pubClient, subClient))
    console.log('> Socket.IO Redis adapter connected')

    // Subscribe to notifications channel for real-time delivery
    await notificationSubClient.subscribe('notifications', (message) => {
      try {
        const { userId, notification, timestamp } = JSON.parse(message)
        console.log(`Received notification from Redis for user-${userId}:`, notification.title)
        io.to(`user-${userId}`).emit('new-notification', { notification, timestamp })
      } catch (err) {
        console.error('Error processing notification from Redis:', err)
      }
    })
    console.log('> Subscribed to Redis notifications channel')

    // Task change fan-out. Lets every open board/dashboard refresh the moment a
    // task is created, reassigned, moved or deleted, instead of waiting for the
    // user to reload — the "1+ minute delay on assignment/transfer" report.
    await taskEventSubClient.subscribe('task-events', (message) => {
      try {
        const { userIds, event } = JSON.parse(message)
        for (const userId of userIds || []) {
          io.to(`user-${userId}`).emit('task-changed', event)
        }
      } catch (err) {
        console.error('Error processing task event from Redis:', err)
      }
    })
    console.log('> Subscribed to Redis task-events channel')
  } catch (redisError) {
    console.warn('> Redis not available, Socket.IO running in single-instance mode')
    console.warn('> For real-time notifications in cluster mode, set REDIS_URL environment variable')
  }

  // Store socket.io instance globally for webhook access
  global.io = io

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id)

    // Join user-specific room
    socket.on('join-calendar-sync', async (userId) => {
      if (!userId) return

      socket.join(`user-${userId}`)
      console.log(`User ${userId} joined calendar sync`)

      // Emit connected status
      io.to(`user-${userId}`).emit('sync-status', {
        isConnected: true,
        timestamp: new Date().toISOString()
      })
    })

    socket.on('leave-calendar-sync', (userId) => {
      if (!userId) return

      socket.leave(`user-${userId}`)
      console.log(`User ${userId} left calendar sync`)
    })

    // Generic per-user room. `join-notifications` and `join-calendar-sync` join
    // the same room for historical reasons; this is the name to use for
    // anything new that just needs the current user's events.
    socket.on('join-user', (userId) => {
      if (!userId) return
      socket.join(`user-${userId}`)
    })

    socket.on('leave-user', (userId) => {
      if (!userId) return
      socket.leave(`user-${userId}`)
    })

    // Join user-specific room for notifications
    socket.on('join-notifications', (userId) => {
      if (!userId) return

      socket.join(`user-${userId}`)
      console.log(`User ${userId} joined notifications room`)
    })

    socket.on('leave-notifications', (userId) => {
      if (!userId) return

      socket.leave(`user-${userId}`)
      console.log(`User ${userId} left notifications room`)
    })

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id)
    })

    socket.on('manual-sync', async (data) => {
      const { userId } = data
      if (!userId) return

      try {
        // Trigger immediate sync
        io.to(`user-${userId}`).emit('sync-started')

        const response = await fetch(`${process.env.NEXTAUTH_URL || `http://localhost:${port}`}/api/calendar/sync-from-google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId })
        })

        if (response.ok) {
          const result = await response.json()
          io.to(`user-${userId}`).emit('sync-completed', result)
        } else {
          io.to(`user-${userId}`).emit('sync-error', { error: 'Sync failed' })
        }
      } catch (error) {
        console.error('Manual sync error:', error)
        io.to(`user-${userId}`).emit('sync-error', { error: error.message })
      }
    })
  })

  // Cleanup on server shutdown
  process.on('SIGTERM', () => {
    httpServer.close()
  })

  httpServer
    .once('error', (err) => {
      console.error(err)
      process.exit(1)
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
      console.log(`> WebSocket server running`)
    })
})
