import { describe, it, expect } from 'vitest'
import { commentTimeLabel } from './comment-time'

const now = new Date(2026, 9, 6, 9, 0) // local time

describe('commentTimeLabel', () => {
  it('is relative within a day', () => {
    expect(commentTimeLabel(new Date(2026, 9, 6, 8, 55), now)).toBe('5 minutes ago')
  })
  it('shows date and time once older than a day', () => {
    expect(commentTimeLabel(new Date(2026, 8, 17, 14, 5), now)).toBe('Sep 17, 2:05 PM')
  })
  it('adds the year for another year', () => {
    expect(commentTimeLabel(new Date(2025, 11, 31, 23, 0), now)).toBe('Dec 31, 2025, 11:00 PM')
  })
  it('is empty for a bad value', () => {
    expect(commentTimeLabel('nope', now)).toBe('')
  })
})
