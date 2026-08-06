import { type OverdueCheckable } from './overdue'

// Four-state schedule-health tag, derived (no stored column). **Day-granular:
// the comparison unit is the exact due date.** A task is late the day after its
// due date — there is no week-long grace period. Anything happening ON the due
// date is on time, matching isTaskOverdue (overdue.ts) and the rest of the app.
//
// The four states split cleanly along active vs. done:
//
//   ACTIVE (TODO / IN_PROGRESS) — is it late right now?
//     ON_TRACK — the due date is today or still ahead.
//     OVERDUE  — past the due date and still not finished. Needs action.
//
//   DONE (IN_REVIEW / COMPLETED) — was it delivered late?
//     AHEAD    — finished on or before the due date.
//     DELAYED  — finished after the due date.
//
// So OVERDUE is a live problem and DELAYED is a historical record; the two never
// apply to the same task at the same time.
//
// This deliberately mirrors isTaskOverdue's day-granular threshold, but the two
// stay separate functions: isTaskOverdue drives overdue counts / notifications /
// the cron and has its own status-exclusion rules (see overdue.ts).
export type ScheduleHealth = 'DELAYED' | 'OVERDUE' | 'ON_TRACK' | 'AHEAD'

export interface ScheduleCheckable extends OverdueCheckable {
  // Leader approval time. Used only as a finish-time fallback for done tasks
  // that predate memberSubmittedAt.
  leaderEvaluatedAt?: Date | string | null
}

// Statuses that carry no schedule-health tag at all: parked or called off.
const NO_TAG_STATUSES = new Set<string>(['CANCELLED', 'BACKLOG'])
// Statuses that count as "done" — judged by finish date vs the due date.
const DONE_STATUSES = new Set<string>(['IN_REVIEW', 'COMPLETED'])

// Midnight at the start of d's calendar day.
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

  const dueDay = startOfDay(new Date(task.dueDate))

  if (task.status && DONE_STATUSES.has(task.status)) {
    // Finish reference: when the member submitted, else leader approval time.
    const finishRaw = task.memberSubmittedAt ?? task.leaderEvaluatedAt ?? null
    let finish: Date
    if (finishRaw) {
      finish = new Date(finishRaw)
    } else if (task.status === 'IN_REVIEW') {
      // Legacy IN_REVIEW with no stamp: compare against today.
      finish = now
    } else {
      // Completed with no timestamps — can't tell when it finished.
      return null
    }
    // Finished on or before the due date is AHEAD; a later day is DELAYED.
    return startOfDay(finish) > dueDay ? 'DELAYED' : 'AHEAD'
  }

  // Active (TODO / IN_PROGRESS): late the day after the due date.
  return startOfDay(now) > dueDay ? 'OVERDUE' : 'ON_TRACK'
}
