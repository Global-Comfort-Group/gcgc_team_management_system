import { describe, it, expect } from 'vitest'
import { isTaskOverdue } from './overdue'

// Fixed "now": 2026-07-03 10:00 local time.
const NOW = new Date(2026, 6, 3, 10, 0, 0)

const day = (d: number, h = 0) => new Date(2026, 6, d, h, 0, 0)

describe('isTaskOverdue', () => {
  it('is false without a due date', () => {
    expect(isTaskOverdue({ status: 'IN_PROGRESS', dueDate: null }, NOW)).toBe(false)
  })

  it('active task past due is overdue; due today is not', () => {
    expect(isTaskOverdue({ status: 'IN_PROGRESS', dueDate: day(2) }, NOW)).toBe(true)
    expect(isTaskOverdue({ status: 'TODO', dueDate: day(3) }, NOW)).toBe(false)
  })

  it('completed/cancelled/backlog are never overdue', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'BACKLOG']) {
      expect(isTaskOverdue({ status, dueDate: day(1) }, NOW)).toBe(false)
    }
  })

  it('IN_REVIEW submitted after the due date stays overdue', () => {
    expect(
      isTaskOverdue(
        { status: 'IN_REVIEW', dueDate: day(1), memberSubmittedAt: day(2, 9) },
        NOW
      )
    ).toBe(true)
  })

  it('IN_REVIEW submitted on the due date (or earlier) is not overdue, even later', () => {
    expect(
      isTaskOverdue(
        { status: 'IN_REVIEW', dueDate: day(1), memberSubmittedAt: day(1, 18) },
        NOW
      )
    ).toBe(false)
    expect(
      isTaskOverdue(
        { status: 'IN_REVIEW', dueDate: day(2), memberSubmittedAt: day(1) },
        NOW
      )
    ).toBe(false)
  })

  it('IN_REVIEW without a submission stamp falls back to comparing today', () => {
    expect(isTaskOverdue({ status: 'IN_REVIEW', dueDate: day(1) }, NOW)).toBe(true)
    expect(isTaskOverdue({ status: 'IN_REVIEW', dueDate: day(3) }, NOW)).toBe(false)
  })

  it('accepts ISO strings for dates', () => {
    expect(
      isTaskOverdue(
        {
          status: 'IN_REVIEW',
          dueDate: day(1).toISOString(),
          memberSubmittedAt: day(2, 9).toISOString(),
        },
        NOW
      )
    ).toBe(true)
  })
})
