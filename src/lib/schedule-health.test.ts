import { describe, it, expect } from 'vitest'
import { getScheduleHealth } from './schedule-health'

// Day-granular schedule health: the due date itself is on time, the next day is
// late. Active tasks are ON_TRACK / OVERDUE; done tasks are AHEAD / DELAYED.
const NOW = new Date(2026, 6, 8, 10, 0, 0) // Wed Jul 8 2026, 10:00
const jul = (d: number, h = 0) => new Date(2026, 6, d, h, 0, 0)
const jun = (d: number, h = 0) => new Date(2026, 5, d, h, 0, 0)

describe('getScheduleHealth (day-granular)', () => {
  it('returns null without a due date', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: null }, NOW)).toBeNull()
  })

  it('returns null for CANCELLED and BACKLOG, even with a due date', () => {
    for (const status of ['CANCELLED', 'BACKLOG']) {
      expect(getScheduleHealth({ status, dueDate: jul(2) }, NOW)).toBeNull()
    }
  })

  // --- active tasks: ON_TRACK / OVERDUE ---------------------------------

  it('active task past its due date is OVERDUE', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: jul(7) }, NOW)).toBe('OVERDUE')
    expect(getScheduleHealth({ status: 'TODO', dueDate: jun(30) }, NOW)).toBe('OVERDUE')
  })

  it('active task due earlier this same week is OVERDUE, not ON_TRACK', () => {
    // due Mon Jul 6, now Wed Jul 8 — same Mon–Sun week, but the date has passed.
    // The old week-granular rule called this ON_TRACK; it is late.
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: jul(6) }, NOW)).toBe('OVERDUE')
  })

  it('active task due TODAY is ON_TRACK — the due date itself is on time', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: jul(8) }, NOW)).toBe('ON_TRACK')
  })

  it('active task due in the future is ON_TRACK', () => {
    expect(getScheduleHealth({ status: 'TODO', dueDate: jul(9) }, NOW)).toBe('ON_TRACK')
    expect(getScheduleHealth({ status: 'TODO', dueDate: jul(31) }, NOW)).toBe('ON_TRACK')
  })

  it('active task flips ON_TRACK -> OVERDUE the day after the due date', () => {
    const task = { status: 'IN_PROGRESS', dueDate: jul(2) } // Thu Jul 2
    expect(getScheduleHealth(task, jul(1, 10))).toBe('ON_TRACK') // day before
    expect(getScheduleHealth(task, jul(2, 0))).toBe('ON_TRACK') // due date, midnight
    expect(getScheduleHealth(task, jul(2, 23))).toBe('ON_TRACK') // due date, last hour
    expect(getScheduleHealth(task, jul(3, 0))).toBe('OVERDUE') // next day, midnight
    expect(getScheduleHealth(task, jul(6, 1))).toBe('OVERDUE') // stays overdue
  })

  // --- done tasks: AHEAD / DELAYED --------------------------------------

  it('done before the due date is AHEAD', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(15), memberSubmittedAt: jul(6) }, NOW)
    ).toBe('AHEAD')
  })

  it('done ON the due date is AHEAD', () => {
    expect(
      getScheduleHealth(
        { status: 'COMPLETED', dueDate: jul(6), memberSubmittedAt: jul(6, 23) },
        NOW
      )
    ).toBe('AHEAD')
  })

  it('done after the due date is DELAYED, even within the same week', () => {
    // due Mon Jul 6, submitted Wed Jul 8 — same Mon–Sun week. The old rule
    // called this AHEAD; it was delivered two days late.
    for (const status of ['IN_REVIEW', 'COMPLETED']) {
      expect(
        getScheduleHealth({ status, dueDate: jul(6), memberSubmittedAt: jul(8) }, NOW)
      ).toBe('DELAYED')
      expect(
        getScheduleHealth({ status, dueDate: jul(6), leaderEvaluatedAt: jul(8) }, NOW)
      ).toBe('DELAYED')
    }
  })

  it('done well after the due date is DELAYED', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2), memberSubmittedAt: jul(8) }, NOW)
    ).toBe('DELAYED')
  })

  it('IN_REVIEW is judged by submission date, not by today', () => {
    // Submitted on time, still waiting on approval — not the assignee's fault.
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(6), memberSubmittedAt: jul(5) }, NOW)
    ).toBe('AHEAD')
    // Submitted late — keeps the late mark while it waits.
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(2), memberSubmittedAt: jul(6) }, NOW)
    ).toBe('DELAYED')
  })

  it('IN_REVIEW without a submission stamp falls back to now', () => {
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(2) }, NOW)).toBe('DELAYED')
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(8) }, NOW)).toBe('AHEAD')
  })

  it('COMPLETED with no timestamps returns null', () => {
    expect(getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2) }, NOW)).toBeNull()
  })

  it('done uses leaderEvaluatedAt when memberSubmittedAt is missing', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2), leaderEvaluatedAt: jul(8) }, NOW)
    ).toBe('DELAYED')
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(15), leaderEvaluatedAt: jul(8) }, NOW)
    ).toBe('AHEAD')
  })

  it('OVERDUE and DELAYED never apply to the same task', () => {
    // Same due date and same late finish: active reads OVERDUE, done reads
    // DELAYED. Active tasks never report DELAYED and done tasks never OVERDUE.
    const dueDate = jul(2)
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate }, NOW)).toBe('OVERDUE')
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate, memberSubmittedAt: jul(8) }, NOW)
    ).toBe('DELAYED')
  })

  it('accepts ISO date strings', () => {
    expect(
      getScheduleHealth(
        {
          status: 'IN_REVIEW',
          dueDate: jul(2).toISOString(),
          memberSubmittedAt: jul(8).toISOString(),
        },
        NOW
      )
    ).toBe('DELAYED')
  })

  it("reproduces the reported case: due Jul 28, still open Jul 31", () => {
    const task = { status: 'IN_PROGRESS', dueDate: jul(28) }
    expect(getScheduleHealth(task, jul(28, 12))).toBe('ON_TRACK')
    expect(getScheduleHealth(task, jul(29, 9))).toBe('OVERDUE')
    expect(getScheduleHealth(task, jul(31, 9))).toBe('OVERDUE')
    // and the done variant that used to read "Ahead of Schedule"
    expect(
      getScheduleHealth(
        { status: 'COMPLETED', dueDate: jul(28), memberSubmittedAt: jul(30) },
        jul(31, 9)
      )
    ).toBe('DELAYED')
  })
})
