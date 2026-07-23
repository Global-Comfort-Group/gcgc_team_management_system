import { describe, it, expect } from 'vitest'
import { getScheduleHealth } from './schedule-health'

// Week-granular schedule health. Weeks run Monday–Sunday.
//   Week A = Jun 29 (Mon) – Jul 5 (Sun)
//   Week B = Jul 6  (Mon) – Jul 12 (Sun)   <- "now" lives here
//   Week C = Jul 13 (Mon) – Jul 19 (Sun)
const NOW = new Date(2026, 6, 8, 10, 0, 0) // Wed Jul 8, week B
const jul = (d: number, h = 0) => new Date(2026, 6, d, h, 0, 0)
const jun = (d: number, h = 0) => new Date(2026, 5, d, h, 0, 0)

describe('getScheduleHealth (weekly, Mon–Sun)', () => {
  it('returns null without a due date', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: null }, NOW)).toBeNull()
  })

  it('returns null for CANCELLED and BACKLOG, even with a due date', () => {
    for (const status of ['CANCELLED', 'BACKLOG']) {
      expect(getScheduleHealth({ status, dueDate: jul(2) }, NOW)).toBeNull()
    }
  })

  it('active task whose deadline week has fully passed is DELAYED', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: jul(2) }, NOW)).toBe('DELAYED')
    expect(getScheduleHealth({ status: 'TODO', dueDate: jun(30) }, NOW)).toBe('DELAYED')
  })

  it('active task due earlier THIS week (past the exact date) is still ON_TRACK', () => {
    // due Mon Jul 6, now Wed Jul 8 — same week B
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: jul(6) }, NOW)).toBe('ON_TRACK')
  })

  it('active task due later this week or a future week is ON_TRACK', () => {
    expect(getScheduleHealth({ status: 'TODO', dueDate: jul(12) }, NOW)).toBe('ON_TRACK') // Sun, week B
    expect(getScheduleHealth({ status: 'TODO', dueDate: jul(15) }, NOW)).toBe('ON_TRACK') // week C
  })

  it('"On Track until the week ends": same task flips to DELAYED only next week', () => {
    const task = { status: 'IN_PROGRESS', dueDate: jul(2) } // week A (Thu)
    expect(getScheduleHealth(task, jul(3, 10))).toBe('ON_TRACK') // Fri Jul 3, still week A
    expect(getScheduleHealth(task, jul(5, 23))).toBe('ON_TRACK') // Sun Jul 5, last day of week A
    expect(getScheduleHealth(task, jul(6, 1))).toBe('DELAYED') // Mon Jul 6, week A has passed
  })

  it('done before the deadline week is AHEAD', () => {
    // due Jul 15 (week C), submitted Jul 6 (week B)
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(15), memberSubmittedAt: jul(6) }, NOW)
    ).toBe('AHEAD')
  })

  it('done within the deadline week is AHEAD, even if after the exact due date', () => {
    // due Mon Jul 6, submitted Wed Jul 8 — same week B
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(6), memberSubmittedAt: jul(8) }, NOW)
    ).toBe('AHEAD')
  })

  it('done in a later week than the deadline is DELAYED', () => {
    // due Jul 2 (week A), submitted Jul 8 (week B)
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2), memberSubmittedAt: jul(8) }, NOW)
    ).toBe('DELAYED')
  })

  it('IN_REVIEW judged by submission week vs deadline week', () => {
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(6), memberSubmittedAt: jul(12) }, NOW)
    ).toBe('AHEAD') // both week B
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(2), memberSubmittedAt: jul(6) }, NOW)
    ).toBe('DELAYED') // week A due, week B submit
  })

  it('IN_REVIEW without a submission stamp falls back to now', () => {
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(2) }, NOW)).toBe('DELAYED') // now week B > week A
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: jul(8) }, NOW)).toBe('AHEAD') // now week B == due week B
  })

  it('COMPLETED with no timestamps returns null', () => {
    expect(getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2) }, NOW)).toBeNull()
  })

  it('done uses leaderEvaluatedAt when memberSubmittedAt is missing', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(2), leaderEvaluatedAt: jul(8) }, NOW)
    ).toBe('DELAYED') // week A due, week B eval
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: jul(15), leaderEvaluatedAt: jul(8) }, NOW)
    ).toBe('AHEAD') // week C due, week B eval
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
})
