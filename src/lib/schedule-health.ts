import { type OverdueCheckable } from './overdue'

// Three-state schedule-health tag, derived (no stored column). Sits alongside
// isTaskOverdue in overdue.ts and shares its day-granular boundary: a task due
// *today* is not late; anything strictly past the due day is.
//
//   DELAYED  — behind: active & past due, or done & submitted after the due day.
//   ON_TRACK — active and still on/before its due day.
//   AHEAD    — done (submitted/evaluated) on or before its due day.
//
// Relationship to isTaskOverdue: for every non-COMPLETED status, DELAYED
// coincides with isTaskOverdue. COMPLETED is the one divergence — isTaskOverdue
// never flags a finished task (nothing to act on), but schedule-health records
// a completed-late task as DELAYED (a historical judgment).
export type ScheduleHealth = 'DELAYED' | 'ON_TRACK' | 'AHEAD'

export interface ScheduleCheckable extends OverdueCheckable {
  // Leader approval time. Used only as a finish-time fallback for done tasks
  // that predate memberSubmittedAt.
  leaderEvaluatedAt?: Date | string | null
}

// Statuses that carry no schedule-health tag at all: parked or called off.
const NO_TAG_STATUSES = new Set<string>(['CANCELLED', 'BACKLOG'])
// Statuses that count as "done" — judged by finish time vs the due day.
const DONE_STATUSES = new Set<string>(['IN_REVIEW', 'COMPLETED'])

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

export function getScheduleHealth(
  task: ScheduleCheckable,
  now: Date = new Date()
): ScheduleHealth | null {
  if (!task.dueDate) return null
  if (task.status && NO_TAG_STATUSES.has(task.status)) return null

  const due = new Date(task.dueDate)

  if (task.status && DONE_STATUSES.has(task.status)) {
    // Finish reference: when the member submitted, else leader approval time.
    const finishRaw = task.memberSubmittedAt ?? task.leaderEvaluatedAt ?? null
    let finish: Date
    if (finishRaw) {
      finish = new Date(finishRaw)
    } else if (task.status === 'IN_REVIEW') {
      // Legacy IN_REVIEW with no stamp: compare against today, matching
      // isTaskOverdue's fallback so the two stay consistent.
      finish = now
    } else {
      // Completed with no timestamps — can't tell when it finished.
      return null
    }
    // DELAYED iff the due date is before the finish day (day-granular), i.e.
    // submitted on/before the due day is AHEAD.
    return due < startOfDay(finish) ? 'DELAYED' : 'AHEAD'
  }

  // Active (TODO / IN_PROGRESS): past the due day is DELAYED, else ON_TRACK.
  return due < startOfDay(now) ? 'DELAYED' : 'ON_TRACK'
}
