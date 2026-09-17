import { prisma } from '@/lib/prisma'
import { broadcastTaskChange } from '@/lib/task-events'

/**
 * Completed tasks move to the Backlog after 5 days (field report 2026-09).
 *
 * The move takes the same snapshot as a manual archive (see backlog-state.ts),
 * so Restore brings the task back as Completed rather than To Do.
 *
 * "5 days in Completed" is measured from the later of completion
 * (leaderEvaluatedAt) and the last edit (updatedAt). The second term matters:
 * restoring a task keeps its old completion time, so without it a restored
 * task would be swept straight back on the next run. The sweep itself leaves
 * updatedAt alone (raw SQL skips @updatedAt): "completed this month" figures
 * key on it, and archiving is not new work.
 *
 * Scope: top-level tasks on a board. Subtasks travel with their parent, and
 * the Backlog is a per-board archive, so board-less tasks have nowhere to go.
 */
export const AUTO_ARCHIVE_DAYS = 5

// Nothing on the production box calls the cron endpoints, so the sweep also
// runs opportunistically when the task list loads — at most this often per
// process. Archiving is only visible to someone viewing tasks anyway.
const MIN_INTERVAL_MS = 10 * 60 * 1000
let lastRun = 0
let running: Promise<number> | null = null

export async function archiveStaleCompletedTasks(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000)
  // Prisma stores these columns as UTC in `timestamp without time zone`. A
  // bound Date would be compared in the session's zone instead, so pass the
  // UTC wall-clock string explicitly.
  const cutoffUtc = cutoff.toISOString().replace('T', ' ').replace('Z', '')
  // One statement so each row's own progress/column go into its snapshot —
  // updateMany cannot copy a column's value.
  const rows = await prisma.$queryRaw<Array<{ id: string; boardId: string | null }>>`
    UPDATE "tasks" SET
      "backlogPriorStatus" = 'COMPLETED',
      "backlogPriorProgress" = "progressPercentage",
      "backlogPriorCustomStatusId" = "customStatusId",
      "status" = 'BACKLOG',
      "progressPercentage" = 0,
      "customStatusId" = NULL
    WHERE "status" = 'COMPLETED'
      AND "parentId" IS NULL
      AND "boardId" IS NOT NULL
      AND "isRecurring" = false
      AND COALESCE("leaderEvaluatedAt", "updatedAt") < ${cutoffUtc}::timestamp
      AND "updatedAt" < ${cutoffUtc}::timestamp
    RETURNING "id", "boardId"
  `
  // Push to open boards. A first run can move a large backlog of old tasks;
  // past a handful, boards pick the change up on their next refresh instead.
  for (const r of rows.slice(0, 50)) {
    await broadcastTaskChange(r.id, 'updated', { boardId: r.boardId }).catch(() => {})
  }
  if (rows.length > 0) console.log(`[auto-archive] moved ${rows.length} completed task(s) to Backlog`)
  return rows.length
}

/** Throttled, non-throwing trigger for request paths. Does not block the caller. */
export function maybeArchiveStaleCompletedTasks(): void {
  const t = Date.now()
  if (running || t - lastRun < MIN_INTERVAL_MS) return
  lastRun = t
  running = archiveStaleCompletedTasks()
    .catch((e) => { console.error('[auto-archive] failed:', e); return 0 })
    .finally(() => { running = null })
}
