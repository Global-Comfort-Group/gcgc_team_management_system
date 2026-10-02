import { describe, it, expect } from 'vitest'
import { resolveReminderHours } from './reminder-hours'

describe('resolveReminderHours', () => {
  it('converts legacy days to hours', () => {
    expect(resolveReminderHours({ reminderDays: [1, 7] })).toEqual([168, 24])
  })
  it('prefers hours when both are sent, and dedupes', () => {
    expect(resolveReminderHours({ reminderHours: [4, 4, 2], reminderDays: [1] })).toEqual([4, 2])
  })
  it('drops invalid values', () => {
    expect(resolveReminderHours({ reminderHours: [0, -3, 1.5, 9999999, 3] })).toEqual([3])
  })
  it('is undefined when neither is sent, so an update leaves reminders alone', () => {
    expect(resolveReminderHours({})).toBeUndefined()
  })
})

import { splitHours, toHours, describeHours } from './reminder-hours'

describe('lead-time conversion', () => {
  it('round-trips amount + unit through hours', () => {
    expect(toHours('3', 'days')).toBe(72)
    expect(toHours(5, 'hours')).toBe(5)
    expect(splitHours(72)).toEqual({ amount: 3, unit: 'days' })
    expect(splitHours(30)).toEqual({ amount: 30, unit: 'hours' })
  })
  it('rejects blanks, zero, fractions and negatives', () => {
    for (const v of ['', '0', '1.5', '-2', 'abc']) expect(toHours(v, 'hours')).toBeNull()
  })
  it('describes in the friendliest unit', () => {
    expect(describeHours(24)).toBe('1 day')
    expect(describeHours(48)).toBe('2 days')
    expect(describeHours(1)).toBe('1 hour')
  })
})
