import { describe, it, expect } from 'vitest'
import { ymdInAppTz } from './app-timezone'

describe('ymdInAppTz', () => {
  it('reports the Philippine date, not the UTC one', () => {
    // Local midnight Oct 10 in Manila is 16:00 UTC on Oct 9.
    expect(ymdInAppTz(new Date('2026-10-09T16:00:00Z'))).toBe('2026-10-10')
  })
  it('is empty for missing or invalid input', () => {
    expect(ymdInAppTz(null)).toBe('')
    expect(ymdInAppTz('nope')).toBe('')
  })
})
