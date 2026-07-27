import { describe, it, expect } from 'vitest'
import { roundBoardProgress, BOARD_PROGRESS_EXCLUDED_STATUSES } from './board-progress'

describe('roundBoardProgress', () => {
  it('is 0 when the board has no qualifying tasks (null avg)', () => {
    expect(roundBoardProgress(null)).toBe(0)
    expect(roundBoardProgress(undefined)).toBe(0)
    expect(roundBoardProgress(NaN)).toBe(0)
  })

  it('rounds the average to the nearest integer', () => {
    expect(roundBoardProgress(60)).toBe(60)
    expect(roundBoardProgress(33.3333)).toBe(33)
    expect(roundBoardProgress(66.6666)).toBe(67)
  })

  it('clamps into 0..100', () => {
    expect(roundBoardProgress(-5)).toBe(0)
    expect(roundBoardProgress(120)).toBe(100)
  })

  it('excludes Cancelled and Backlog from the aggregate', () => {
    expect([...BOARD_PROGRESS_EXCLUDED_STATUSES]).toEqual(['CANCELLED', 'BACKLOG'])
  })
})
