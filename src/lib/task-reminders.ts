import type { PrismaClient } from '@prisma/client'
import { createNotification } from '@/lib/notifications'
import { CLOSED_TASK_STATUSES } from '@/lib/task-scope'

const HOUR = 60 * 60 * 1000

/**
 * Reminder thresholds are "N hours before the due date". A reminder is due once
 * `now >= dueDate - N hours` and the task isn't due yet.
 *
 * When several thresholds are past at once (a task created 2h before a 24h and
 * a 4h reminder, or the server was down), only ONE reminder goes out — for the
 * nearest threshold — and every past threshold is marked sent, so nobody gets
 * a burst of identical emails. Pure, so it can be unit-tested.
 */
export function planReminder(
  task: { dueDate: Date | null; reminderHours: number[]; remindersSentHours: number[] },
  now: Date,
): { send: number | null; markSent: number[] } {
  if (!task.dueDate || task.dueDate.getTime() <= now.getTime()) return { send: null, markSent: [] }
  const sent = new Set(task.remindersSentHours)
  const due = task.dueDate.getTime()
  const passed = Array.from(new Set(task.reminderHours))
    .filter((h) => h > 0 && !sent.has(h) && now.getTime() >= due - h * HOUR)
    .sort((a, b) => a - b)
  if (passed.length === 0) return { send: null, markSent: [] }
  return { send: passed[0], markSent: passed }
}

/** "3 hours", "1 day", "2 days" — whole days when it divides evenly. */
export function formatLeadTime(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24
    return `${d} day${d === 1 ? '' : 's'}`
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

/**
 * Send every reminder that has come due. Run every few minutes by the custom
 * server (see server.js → /api/cron/reminders). Returns how many were sent.
 */
export async function sendDueReminders(db: PrismaClient, now = new Date()): Promise<number> {
  const tasks = await db.task.findMany({
    where: {
      status: { notIn: [...CLOSED_TASK_STATUSES] },
      isRecurring: false,
      dueDate: { gt: now },
      reminderHours: { isEmpty: false },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      reminderHours: true,
      remindersSentHours: true,
      assigneeId: true,
      assignees: { select: { userId: true } },
    },
    take: 2000,
  })

  let sent = 0
  for (const task of tasks) {
    const plan = planReminder(task, now)
    if (plan.send === null) continue
    // Mark first: a crash after notifying must not re-send next tick.
    await db.task.update({
      where: { id: task.id },
      data: { remindersSentHours: Array.from(new Set([...task.remindersSentHours, ...plan.markSent])) },
    })
    const recipients = new Set<string>([
      ...(task.assigneeId ? [task.assigneeId] : []),
      ...task.assignees.map((a) => a.userId),
    ])
    for (const userId of Array.from(recipients)) {
      await createNotification({
        userId,
        type: 'DEADLINE_REMINDER',
        title: 'Task due soon',
        message: `"${task.title}" is due in ${formatLeadTime(plan.send)} (${task.dueDate!.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}).`,
        entityId: task.id,
        entityType: 'task',
      }).catch((e) => console.error('[reminders] notify failed', task.id, e))
      sent++
    }
  }
  return sent
}
