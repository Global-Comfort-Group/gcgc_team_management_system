import type { TaskStatus } from '@prisma/client'

/**
 * Preserving a task's state across a trip to the Backlog.
 *
 * The Backlog is an archive, not a column: archiving hides a task from the
 * board and restoring brings it back. It used to bring everything back as
 * To Do at 0%, losing whatever the task was actually doing — because the
 * archive step itself overwrote progress and detached the column. By restore
 * time the information was already gone, so no amount of work in the restore
 * handler could recover it. The snapshot has to be taken on the way IN.
 */

export interface BacklogSnapshotSource {
  status: TaskStatus
  progressPercentage: number
  customStatusId: string | null
}

export interface BacklogSnapshot {
  backlogPriorStatus: TaskStatus | null
  backlogPriorProgress: number | null
  backlogPriorCustomStatusId: string | null
}

/**
 * Fields to write when a task is archived to the Backlog: capture where it was,
 * then clear the live state so it leaves the board cleanly.
 *
 * A task already in the Backlog is not re-snapshotted — doing so would
 * overwrite a good snapshot with `BACKLOG`/0 and permanently lose the original.
 */
export function resolveBacklogEntry(current: BacklogSnapshotSource): BacklogSnapshot & {
  status: TaskStatus
  progressPercentage: number
  customStatusId: null
} {
  const alreadyArchived = current.status === 'BACKLOG'
  return {
    backlogPriorStatus: alreadyArchived ? null : current.status,
    backlogPriorProgress: alreadyArchived ? null : current.progressPercentage,
    backlogPriorCustomStatusId: alreadyArchived ? null : current.customStatusId,
    status: 'BACKLOG' as TaskStatus,
    progressPercentage: 0,
    customStatusId: null,
  }
}

/**
 * Fields to write when a task is restored from the Backlog: put back what was
 * captured, and clear the snapshot so a later archive starts fresh.
 *
 * Falls back to To Do at 0% when there is no snapshot — tasks archived before
 * this existed, which is the old behaviour and the only honest answer for them.
 */
export function resolveBacklogRestore(snapshot: Partial<BacklogSnapshot>): {
  status: TaskStatus
  progressPercentage: number
  customStatusId: string | null
} & BacklogSnapshot {
  return {
    status: (snapshot.backlogPriorStatus ?? 'TODO') as TaskStatus,
    progressPercentage: snapshot.backlogPriorProgress ?? 0,
    customStatusId: snapshot.backlogPriorCustomStatusId ?? null,
    backlogPriorStatus: null,
    backlogPriorProgress: null,
    backlogPriorCustomStatusId: null,
  }
}

/**
 * True when this PATCH moves a task out of the Backlog by explicitly setting
 * some other status (dragging an archived card onto a column, say) rather than
 * via the Restore action. The snapshot is stale afterwards either way, so it
 * gets cleared — the caller's explicit choice wins over the remembered one.
 */
export function leavesBacklogExplicitly(
  currentStatus: TaskStatus,
  incomingStatus: TaskStatus | undefined
): boolean {
  return currentStatus === 'BACKLOG' && !!incomingStatus && incomingStatus !== 'BACKLOG'
}
