import { type OverdueCheckable } from './overdue'

// Three-state schedule-health tag, derived (no stored column). **Week-granular:
// weeks run Monday–Sunday.** The comparison unit is the deadline's calendar week,
// not its exact day — a task stays fine for the whole of its deadline week and is
// only late once that week has fully passed.
//
//   DELAYED  — behind: active & the deadline week has passed, or done & finished
//              in a later week than the deadline.
//   ON_TRACK — active and the deadline is this week or a future week.
//   AHEAD    — done (submitted/evaluated) within the deadline week or earlier.
//
// This is intentionally NOT the same as isTaskOverdue (overdue.ts), which stays
// day-granular and drives overdue counts / notifications / the cron. A task past
// its exact due date but still inside its deadline week is isTaskOverdue===true
// yet schedule-health ON_TRACK — the two answer different questions.
export type ScheduleHealth = 'DELAYED' | 'ON_TRACK' | 'AHEAD'

export interface ScheduleCheckable extends OverdueCheckable {
  // Leader approval time. Used only as a finish-time fallback for done tasks
  // that predate memberSubmittedAt.
  leaderEvaluatedAt?: Date | string | null
}

// Statuses that carry no schedule-health tag at all: parked or called off.
const NO_TAG_STATUSES = new Set<string>(['CANCELLED', 'BACKLOG'])
// Statuses that count as "done" — judged by finish week vs the deadline week.
const DONE_STATUSES = new Set<string>(['IN_REVIEW', 'COMPLETED'])

// Monday 00:00 of the Mon–Sun week containing d.
function startOfWeek(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  const day = s.getDay() // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  s.setDate(s.getDate() + diffToMonday)
  return s
}

export function getScheduleHealth(
  task: ScheduleCheckable,
  now: Date = new Date()
): ScheduleHealth | null {
  if (!task.dueDate) return null
  if (task.status && NO_TAG_STATUSES.has(task.status)) return null

  const dueWeek = startOfWeek(new Date(task.dueDate))

  if (task.status && DONE_STATUSES.has(task.status)) {
    // Finish reference: when the member submitted, else leader approval time.
    const finishRaw = task.memberSubmittedAt ?? task.leaderEvaluatedAt ?? null
    let finish: Date
    if (finishRaw) {
      finish = new Date(finishRaw)
    } else if (task.status === 'IN_REVIEW') {
      // Legacy IN_REVIEW with no stamp: compare against today's week.
      finish = now
    } else {
      // Completed with no timestamps — can't tell when it finished.
      return null
    }
    // Finished within the deadline week (or an earlier week) is AHEAD; a later
    // week is DELAYED.
    return startOfWeek(finish) > dueWeek ? 'DELAYED' : 'AHEAD'
  }

  // Active (TODO / IN_PROGRESS): on track through the whole deadline week;
  // delayed once that week has fully passed.
  return startOfWeek(now) > dueWeek ? 'DELAYED' : 'ON_TRACK'
}
