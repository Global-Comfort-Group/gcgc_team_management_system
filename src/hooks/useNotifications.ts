'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { io, Socket } from 'socket.io-client'

interface Notification {
  id: string
  userId: string
  type: 'TASK_ASSIGNED' | 'TASK_UPDATED' | 'TASK_COMPLETED' | 'COMMENT_ADDED' | 'MENTION' | 'DEADLINE_REMINDER' | 'TEAM_INVITATION' | 'BOARD_MEMBER_ADDED' | 'TASK_SUBMITTED_FOR_REVIEW'
  title: string
  message: string
  isRead: boolean
  entityId?: string
  entityType?: string
  createdAt: string
  readAt?: string
}

export function useNotifications() {
  const { data: session } = useSession()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  // Fetch notifications from API
  const fetchNotifications = useCallback(async () => {
    if (!session?.user?.id) return

    try {
      const response = await fetch('/api/notifications?limit=50')
      if (response.ok) {
        const data = await response.json()
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
      }
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  // Initialize socket connection for real-time notifications
  useEffect(() => {
    if (!session?.user?.id) return

    const socketInstance = io({
      path: '/socket.io',
    })

    socketInstance.on('connect', () => {
      console.log('Notifications: WebSocket connected')
      // Join user-specific room for notifications
      socketInstance.emit('join-notifications', session.user.id)
    })

    socketInstance.on('new-notification', (data) => {
      console.log('New notification received:', data)
      // Add new notification to the top of the list
      setNotifications(prev => [data.notification, ...prev])
      setUnreadCount(prev => prev + 1)

      // Play notification sound
      try {
        const audio = new Audio('/sounds/notification.mp3')
        audio.volume = 0.5
        audio.play().catch(() => {})
      } catch {}
    })

    socketInstance.on('disconnect', () => {
      console.log('Notifications: WebSocket disconnected')
    })

    setSocket(socketInstance)

    // Fetch initial notifications
    fetchNotifications()

    // Poll every 30 seconds as fallback for missed WebSocket events
    const pollInterval = setInterval(fetchNotifications, 30000)

    // Refetch when window regains focus
    const handleFocus = () => fetchNotifications()
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(pollInterval)
      window.removeEventListener('focus', handleFocus)
      if (session?.user?.id) {
        socketInstance.emit('leave-notifications', session.user.id)
      }
      socketInstance.disconnect()
    }
  }, [session?.user?.id, fetchNotifications])

  // Mark notifications as read
  const markAsRead = useCallback(async (notificationIds?: string[]) => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          notificationIds
            ? { notificationIds }
            : { markAllRead: true }
        ),
      })

      if (response.ok) {
        if (notificationIds) {
          // Mark specific notifications as read
          setNotifications(prev =>
            prev.map(n =>
              notificationIds.includes(n.id)
                ? { ...n, isRead: true, readAt: new Date().toISOString() }
                : n
            )
          )
          setUnreadCount(prev => Math.max(0, prev - notificationIds.length))
        } else {
          // Mark all as read
          setNotifications(prev =>
            prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
          )
          setUnreadCount(0)
        }
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error)
    }
  }, [])

  // Mark single notification as read
  const markOneAsRead = useCallback((notificationId: string) => {
    markAsRead([notificationId])
  }, [markAsRead])

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    markAsRead()
  }, [markAsRead])

  return {
    notifications,
    unreadCount,
    loading,
    markOneAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  }
}
