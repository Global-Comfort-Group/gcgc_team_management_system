import { describe, it, expect } from 'vitest'
import {
  roundBoardProgress,
  BOARD_PROGRESS_EXCLUDED_STATUSES,
  weightedMeasurementProgress,
  resolveBoardActual,
} from './board-progress'

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

describe('weightedMeasurementProgress', () => {
  it('is null when there are no measurements or total weight is 0', () => {
    expect(weightedMeasurementProgress([])).toBeNull()
    expect(weightedMeasurementProgress([{ weight: 0, progress: 50 }])).toBeNull()
  })

  it('weights each phase by its share', () => {
    // BRD 10%@100, Dev 40%@50, Testing 30%@0, Deploy 20%@0 -> (1000+2000)/100 = 30
    expect(
      weightedMeasurementProgress([
        { weight: 10, progress: 100 },
        { weight: 40, progress: 50 },
        { weight: 30, progress: 0 },
        { weight: 20, progress: 0 },
      ])
    ).toBe(30)
  })

  it('normalizes when weights do not sum to 100', () => {
    // weights 10 + 40 = 50; (10*100 + 40*50)/50 = 60
    expect(
      weightedMeasurementProgress([
        { weight: 10, progress: 100 },
        { weight: 40, progress: 50 },
      ])
    ).toBe(60)
  })

  it('clamps out-of-range progress', () => {
    expect(weightedMeasurementProgress([{ weight: 1, progress: 150 }])).toBe(100)
    expect(weightedMeasurementProgress([{ weight: 1, progress: -20 }])).toBe(0)
  })
})

describe('resolveBoardActual', () => {
  const measurements = [
    { weight: 10, progress: 100 },
    { weight: 40, progress: 50 },
  ]

  it('uses the manual override when set (clamped)', () => {
    expect(resolveBoardActual({ manualActualPercent: 72, measurements, taskAveragePercent: 30 })).toBe(72)
    expect(resolveBoardActual({ manualActualPercent: 140, measurements, taskAveragePercent: 30 })).toBe(100)
  })

  it('falls back to weighted measurements when no manual override', () => {
    expect(resolveBoardActual({ manualActualPercent: null, measurements, taskAveragePercent: 30 })).toBe(60)
  })

  it('falls back to task average when there are no measurements', () => {
    expect(resolveBoardActual({ manualActualPercent: null, measurements: [], taskAveragePercent: 47 })).toBe(47)
  })
})
