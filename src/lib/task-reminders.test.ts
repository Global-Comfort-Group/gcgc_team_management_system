import { describe, it, expect } from 'vitest'
import { planReminder, describeTimeLeft } from './task-reminders'

const now = new Date('2026-10-02T08:00:00Z')
const inHours = (h: number) => new Date(now.getTime() + h * 3600_000)

describe('planReminder', () => {
  it('sends a reminder once its threshold has passed', () => {
    expect(planReminder({ dueDate: inHours(20), reminderHours: [24], remindersSentHours: [] }, now))
      .toEqual({ send: 24, markSent: [24] })
  })

  it('waits until the threshold', () => {
    expect(planReminder({ dueDate: inHours(30), reminderHours: [24], remindersSentHours: [] }, now).send).toBeNull()
  })

  it('never re-sends one already sent', () => {
    expect(planReminder({ dueDate: inHours(20), reminderHours: [24], remindersSentHours: [24] }, now).send).toBeNull()
  })

  it('collapses several past thresholds into one reminder for the nearest', () => {
    expect(planReminder({ dueDate: inHours(2), reminderHours: [168, 24, 4], remindersSentHours: [] }, now))
      .toEqual({ send: 4, markSent: [4, 24, 168] })
  })

  it('sends nothing once the task is due, or without a due date', () => {
    expect(planReminder({ dueDate: inHours(-1), reminderHours: [24], remindersSentHours: [] }, now).send).toBeNull()
    expect(planReminder({ dueDate: null, reminderHours: [24], remindersSentHours: [] }, now).send).toBeNull()
  })
})

describe('describeTimeLeft', () => {
  it('reports the real time left, not the reminder threshold', () => {
    expect(describeTimeLeft(70 * 60_000)).toBe('about 1 hour')
    expect(describeTimeLeft(20 * 60_000)).toBe('less than an hour')
    expect(describeTimeLeft(26 * 3600_000)).toBe('about 26 hours')
    expect(describeTimeLeft(72 * 3600_000)).toBe('about 3 days')
  })
})
