import { describe, it, expect } from 'vitest'
import { getScheduleHealth } from './schedule-health'
import { isTaskOverdue } from './overdue'

// Fixed "now": 2026-07-03 10:00 local time (same convention as overdue.test).
const NOW = new Date(2026, 6, 3, 10, 0, 0)
const day = (d: number, h = 0) => new Date(2026, 6, d, h, 0, 0)

describe('getScheduleHealth', () => {
  it('returns null without a due date', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: null }, NOW)).toBeNull()
  })

  it('returns null for CANCELLED and BACKLOG, even with a due date', () => {
    for (const status of ['CANCELLED', 'BACKLOG']) {
      expect(getScheduleHealth({ status, dueDate: day(1) }, NOW)).toBeNull()
    }
  })

  it('active task past its due day is DELAYED', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: day(2) }, NOW)).toBe('DELAYED')
    expect(getScheduleHealth({ status: 'TODO', dueDate: day(1) }, NOW)).toBe('DELAYED')
  })

  it('active task due today or in the future is ON_TRACK', () => {
    expect(getScheduleHealth({ status: 'IN_PROGRESS', dueDate: day(3, 8) }, NOW)).toBe('ON_TRACK')
    expect(getScheduleHealth({ status: 'TODO', dueDate: day(5) }, NOW)).toBe('ON_TRACK')
  })

  it('IN_REVIEW submitted on/before the due day is AHEAD', () => {
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: day(1), memberSubmittedAt: day(1, 18) }, NOW)
    ).toBe('AHEAD')
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: day(2), memberSubmittedAt: day(1) }, NOW)
    ).toBe('AHEAD')
  })

  it('IN_REVIEW submitted after the due day is DELAYED', () => {
    expect(
      getScheduleHealth({ status: 'IN_REVIEW', dueDate: day(1), memberSubmittedAt: day(2, 9) }, NOW)
    ).toBe('DELAYED')
  })

  it('COMPLETED before the due day is AHEAD', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: day(5), memberSubmittedAt: day(2) }, NOW)
    ).toBe('AHEAD')
  })

  it('COMPLETED after the due day is DELAYED (diverges from isTaskOverdue)', () => {
    const task = { status: 'COMPLETED', dueDate: day(1), memberSubmittedAt: day(3, 9) }
    expect(getScheduleHealth(task, NOW)).toBe('DELAYED')
    // isTaskOverdue intentionally never flags a COMPLETED task.
    expect(isTaskOverdue(task, NOW)).toBe(false)
  })

  it('IN_REVIEW without a submission stamp falls back to now (matches isTaskOverdue)', () => {
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: day(1) }, NOW)).toBe('DELAYED')
    expect(getScheduleHealth({ status: 'IN_REVIEW', dueDate: day(5) }, NOW)).toBe('AHEAD')
  })

  it('COMPLETED with no timestamps returns null (cannot judge when it finished)', () => {
    expect(getScheduleHealth({ status: 'COMPLETED', dueDate: day(1) }, NOW)).toBeNull()
  })

  it('done task uses leaderEvaluatedAt when memberSubmittedAt is missing', () => {
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: day(1), leaderEvaluatedAt: day(3, 9) }, NOW)
    ).toBe('DELAYED')
    expect(
      getScheduleHealth({ status: 'COMPLETED', dueDate: day(5), leaderEvaluatedAt: day(2) }, NOW)
    ).toBe('AHEAD')
  })

  it('accepts ISO date strings', () => {
    expect(
      getScheduleHealth(
        {
          status: 'IN_REVIEW',
          dueDate: day(1).toISOString(),
          memberSubmittedAt: day(2, 9).toISOString(),
        },
        NOW
      )
    ).toBe('DELAYED')
  })

  it('for non-COMPLETED statuses, DELAYED coincides with isTaskOverdue', () => {
    const cases = [
      { status: 'IN_PROGRESS', dueDate: day(2) },
      { status: 'TODO', dueDate: day(5) },
      { status: 'IN_REVIEW', dueDate: day(1), memberSubmittedAt: day(2, 9) },
      { status: 'IN_REVIEW', dueDate: day(2), memberSubmittedAt: day(1) },
    ]
    for (const t of cases) {
      const delayed = getScheduleHealth(t, NOW) === 'DELAYED'
      expect(delayed).toBe(isTaskOverdue(t, NOW))
    }
  })
})
