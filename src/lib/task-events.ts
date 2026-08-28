import { prisma } from '@/lib/prisma'
import { getRedisClient } from '@/lib/redis'

/**
 * Task change fan-out.
 *
 * Boards and dashboards used to fetch once on mount and never again, so a task
 * assigned or transferred by someone else stayed invisible until the recipient
 * reloaded the page. This publishes a lightweight "something about this task
 * changed" signal to everyone connected to it; the client refetches on receipt.
 *
 * The payload deliberately carries no task data — only an id and a reason. It
 * crosses a fan-out boundary to users whose permissions aren't re-checked here,
 * so the client refetches through the normal authorised endpoints instead.
 */

export type TaskEventReason = 'created' | 'updated' | 'deleted'

export interface TaskChangedEvent {
  taskId: string
  reason: TaskEventReason
  /** Board the task sits on, so a board view can ignore other boards' churn. */
  boardId?: string | null
  at: string
}

/**
 * Everyone who should hear about a change to `taskId`: the assignee, the
 * creator, whoever assigned it, its team members and collaborators, its
 * subtask assignees, and every leader of its team.
 *
 * `extraUserIds` covers people the change removes — a previous assignee is no
 * longer attached to the task, but their board still shows the stale card.
 */
export async function resolveTaskAudience(
  taskId: string,
  extraUserIds: (string | null | undefined)[] = []
): Promise<string[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assigneeId: true,
      creatorId: true,
      assignedById: true,
      parentId: true,
      teamId: true,
      teamMembers: { select: { userId: true } },
      collaborators: { select: { userId: true } },
      subtasks: { select: { assigneeId: true } },
      parent: { select: { assigneeId: true, creatorId: true } },
      team: { select: { members: { select: { userId: true } } } },
      board: { select: { team: { select: { members: { select: { userId: true } } } } } },
    },
  })

  const ids = new Set<string>()
  const add = (id: string | null | undefined) => { if (id) ids.add(id) }

  for (const id of extraUserIds) add(id)

  if (task) {
    add(task.assigneeId)
    add(task.creatorId)
    add(task.assignedById)
    add(task.parent?.assigneeId)
    add(task.parent?.creatorId)
    task.teamMembers.forEach(m => add(m.userId))
    task.collaborators.forEach(c => add(c.userId))
    task.subtasks.forEach(st => add(st.assigneeId))
    // Team scoped through the board as well as the task: pre-derivation tasks
    // have teamId = null even on a team board.
    task.team?.members.forEach(m => add(m.userId))
    task.board?.team?.members.forEach(m => add(m.userId))
  }

  return Array.from(ids)
}

/**
 * Publish a task change to the given users.
 *
 * Redis is the path that works under PM2 cluster mode; `global.io` is the
 * single-process fallback for deployments running without Redis (server.js logs
 * "Redis not available, Socket.IO running in single-instance mode"). Never
 * throws — a failed broadcast must not fail the write that triggered it, since
 * the client keeps a polling fallback.
 */
export async function emitTaskChanged(
  userIds: string[],
  event: Omit<TaskChangedEvent, 'at'>
): Promise<void> {
  if (userIds.length === 0) return
  const payload: TaskChangedEvent = { ...event, at: new Date().toISOString() }

  try {
    const client = await getRedisClient()
    if (client) {
      await client.publish('task-events', JSON.stringify({ userIds, event: payload }))
      return
    }
  } catch (error) {
    console.error('[task-events] redis publish failed:', error)
  }

  try {
    const io = (global as unknown as { io?: { to: (room: string) => { emit: (ev: string, data: unknown) => void } } }).io
    if (io) {
      for (const userId of userIds) io.to(`user-${userId}`).emit('task-changed', payload)
    }
  } catch (error) {
    console.error('[task-events] direct emit failed:', error)
  }
}

/** Convenience: resolve the audience and broadcast in one step. */
export async function broadcastTaskChange(
  taskId: string,
  reason: TaskEventReason,
  opts: { boardId?: string | null; extraUserIds?: (string | null | undefined)[] } = {}
): Promise<void> {
  try {
    const audience = await resolveTaskAudience(taskId, opts.extraUserIds ?? [])
    await emitTaskChanged(audience, { taskId, reason, boardId: opts.boardId })
  } catch (error) {
    console.error('[task-events] broadcast failed for', taskId, error)
  }
}
