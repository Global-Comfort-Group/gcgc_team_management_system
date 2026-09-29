import { describe, it, expect } from 'vitest'
import { gradientToRating, ratingToGradient, formatRating } from './evaluation-score'

describe('evaluation score display', () => {
  it('maps each stored gradient onto its 1–5 grade', () => {
    expect([0, 25, 50, 75, 100].map(gradientToRating)).toEqual([1, 2, 3, 4, 5])
  })

  it('round-trips a grade through the stored gradient', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(gradientToRating(ratingToGradient(rating))).toBe(rating)
    }
  })

  it('prints whole grades flat and averages to one decimal', () => {
    expect(formatRating(75)).toBe('4')
    // An average of 75s and 100s: 3.8/5 must not round away to a flat 4.
    expect(formatRating(70, 1)).toBe('3.8')
  })
})
