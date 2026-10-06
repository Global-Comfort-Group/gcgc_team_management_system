import { describe, it, expect } from 'vitest'
import { commentTimeLabel, commentTimeFull } from './comment-time'

// All instants in UTC; expected labels are Philippine time (UTC+8).
const now = new Date('2026-10-06T01:00:00Z') // 9:00 AM PH

describe('commentTimeLabel', () => {
  it('is relative within a day', () => {
    expect(commentTimeLabel(new Date('2026-10-06T00:55:00Z'), now)).toBe('5 minutes ago')
  })
  it('says "just now" for the last minute and for a viewer clock running behind', () => {
    expect(commentTimeLabel(new Date('2026-10-06T00:59:40Z'), now)).toBe('just now')
    expect(commentTimeLabel(new Date('2026-10-06T01:02:00Z'), now)).toBe('just now')
  })
  it('shows the Philippine date and time once older than a day, whatever the PC timezone', () => {
    // 07:28 UTC = 3:28 PM in Manila
    expect(commentTimeLabel(new Date('2026-09-17T07:28:00Z'), now)).toBe('Sep 17, 3:28 PM')
    // 18:30 UTC on Sep 30 is already Oct 1 in Manila
    expect(commentTimeLabel(new Date('2026-09-30T18:30:00Z'), now)).toBe('Oct 1, 2:30 AM')
  })
  it('adds the year for another year', () => {
    expect(commentTimeLabel(new Date('2025-12-31T15:00:00Z'), now)).toBe('Dec 31, 2025, 11:00 PM')
  })
  it('is empty for a bad value', () => {
    expect(commentTimeLabel('nope', now)).toBe('')
  })
})

describe('commentTimeFull', () => {
  it('spells out the Philippine time', () => {
    expect(commentTimeFull(new Date('2026-09-17T07:28:00Z'))).toBe('Thursday, Sep 17, 2026, 3:28 PM (PH time)')
  })
})
