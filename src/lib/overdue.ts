import type { TaskStatus } from '@prisma/client'

// A task is never counted as "overdue" while it is in one of these states:
//  - COMPLETED / CANCELLED: the work is finished or called off.
//  - IN_REVIEW: the assignee has submitted and it's waiting on a leader/owner
//    to approve. That wait is not the assignee's fault, so a past-due task that
//    is already In Review must not show as overdue.
//  - BACKLOG: parked work outside the active flow — never overdue while parked.
export const OVERDUE_EXCLUDED_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED', 'IN_REVIEW', 'BACKLOG']

// True when a task in this status is eligible to be considered overdue (caller
// still applies the due-date check). Used for in-memory checks; Prisma queries
// use `status: { notIn: OVERDUE_EXCLUDED_STATUSES }`.
export function isOverdueStatus(status: string | null | undefined): boolean {
  return !!status && !OVERDUE_EXCLUDED_STATUSES.includes(status as TaskStatus)
}

export interface OverdueCheckable {
  status: string | null | undefined
  dueDate?: Date | string | null
  memberSubmittedAt?: Date | string | null
}

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

// Canonical overdue check. Day-granular like the rest of the app: a task due
// yesterday is overdue today; anything happening on the due date itself is on
// time.
//
// IN_REVIEW is judged by when the assignee passed the task to review, not by
// the current date: a task submitted on time never becomes overdue while it
// waits for approval, but a task submitted AFTER its due date keeps its
// overdue flag until it is approved/completed.
//
// Prisma cannot compare two columns in a `where`, so query-side callers count
// `status: { notIn: OVERDUE_EXCLUDED_STATUSES }, dueDate: { lt: startOfToday }`
// and separately fetch IN_REVIEW rows to filter with this function.
export function isTaskOverdue(task: OverdueCheckable, now: Date = new Date()): boolean {
  if (!task.dueDate) return false
  const due = new Date(task.dueDate)
  if (task.status === 'IN_REVIEW') {
    // Tasks that entered review before memberSubmittedAt existed have no
    // stamp; treat them as still pending (compare against today).
    const submitted = task.memberSubmittedAt ? new Date(task.memberSubmittedAt) : now
    return due < startOfDay(submitted)
  }
  if (!isOverdueStatus(task.status)) return false
  return due < startOfDay(now)
}
