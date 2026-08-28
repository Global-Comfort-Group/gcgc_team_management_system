'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { io } from 'socket.io-client'

interface TaskChangedEvent {
  taskId: string
  reason: 'created' | 'updated' | 'deleted'
  boardId?: string | null
  at: string
}

interface Options {
  /**
   * Background poll, in ms. This is the fallback for a dropped or unavailable
   * socket, not the primary path — the socket usually lands first. Set to 0 to
   * disable. Polls are skipped while the tab is hidden.
   */
  pollMs?: number
  /** Skip work entirely (e.g. the page is only for leaders). */
  enabled?: boolean
}

/**
 * Keep a task view current without the user reloading.
 *
 * Boards and dashboards fetched once on mount, so a task someone else assigned
 * or transferred did not appear until a manual refresh — reported as a delay of
 * a minute or more. This subscribes to the `task-changed` events the API
 * broadcasts over the Socket.IO server that already runs for notifications and
 * calendar sync (see `src/lib/task-events.ts`), and falls back to a poll plus a
 * refetch on regaining focus so the page still converges if the socket is down.
 *
 * `onRefresh` is held in a ref, so an inline arrow function will not tear the
 * subscription down and rebuild it on every render.
 */
export function useTaskRefresh(onRefresh: () => void, options: Options = {}) {
  const { pollMs = 30000, enabled = true } = options
  const { data: session } = useSession()
  const userId = session?.user?.id
  const callbackRef = useRef(onRefresh)
  callbackRef.current = onRefresh

  useEffect(() => {
    if (!enabled || !userId) return

    const refresh = () => callbackRef.current()

    const socket = io({ path: '/socket.io' })
    socket.on('connect', () => socket.emit('join-user', userId))
    socket.on('task-changed', (_event: TaskChangedEvent) => refresh())

    // Coming back to the tab is the moment a stale view is most visible.
    const onFocus = () => refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    // Don't poll a hidden tab — it wakes the DB for a view nobody is reading.
    const interval = pollMs > 0
      ? setInterval(() => { if (document.visibilityState === 'visible') refresh() }, pollMs)
      : null

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      if (interval) clearInterval(interval)
      socket.emit('leave-user', userId)
      socket.disconnect()
    }
  }, [userId, enabled, pollMs])
}
