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
  return clampPct(Math.round(avg))
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n))

export interface Measurement {
  weight: number
  progress: number
}

// Project Info: the weight-weighted average of measurement progress. Normalizes
// by the total weight (so it works even if weights don't sum to exactly 100).
// Returns null when there are no measurements with positive weight.
export function weightedMeasurementProgress(measurements: Measurement[]): number | null {
  const totalWeight = measurements.reduce((acc, m) => acc + Math.max(0, m.weight || 0), 0)
  if (totalWeight <= 0) return null
  const sum = measurements.reduce(
    (acc, m) => acc + Math.max(0, m.weight || 0) * clampPct(m.progress || 0),
    0
  )
  return Math.round(sum / totalWeight)
}

// The board's actual project %: a manual override wins; else the weighted
// measurements (if any); else the average finished-task % (task-based default).
export function resolveBoardActual(opts: {
  manualActualPercent?: number | null
  measurements: Measurement[]
  taskAveragePercent: number
}): number {
  if (opts.manualActualPercent != null) return clampPct(Math.round(opts.manualActualPercent))
  const weighted = weightedMeasurementProgress(opts.measurements)
  if (weighted != null) return weighted
  return clampPct(Math.round(opts.taskAveragePercent))
}
