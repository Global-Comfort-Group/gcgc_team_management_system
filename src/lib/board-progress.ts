// A kanban board's overall completion %: the average progressPercentage of its
// top-level tasks, excluding Cancelled and Backlog (parked/called-off work
// shouldn't drag the project number). Subtasks are excluded because their
// progress already rolls up into their parent task.
//
// Computed server-side (filter-independent) via a Prisma groupBy _avg over
//   { boardId, parentId: null, status: { notIn: BOARD_PROGRESS_EXCLUDED_STATUSES } }
// then rounded with roundBoardProgress(). Kept in one place so every surface
// (board header, Teams cards) shows the same number.
export const BOARD_PROGRESS_EXCLUDED_STATUSES = ['CANCELLED', 'BACKLOG'] as const

// Round a Prisma `_avg.progressPercentage` (null when the board has no
// qualifying tasks) to an integer board %.
export function roundBoardProgress(avg: number | null | undefined): number {
  if (avg == null || Number.isNaN(avg)) return 0
  return Math.max(0, Math.min(100, Math.round(avg)))
}
