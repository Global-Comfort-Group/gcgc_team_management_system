import { describe, it, expect } from 'vitest'
import {
  resolveBacklogEntry,
  resolveBacklogRestore,
  leavesBacklogExplicitly,
} from './backlog-state'

describe('resolveBacklogEntry', () => {
  it('captures where the task was before clearing it', () => {
    const out = resolveBacklogEntry({
      status: 'IN_PROGRESS',
      progressPercentage: 60,
      customStatusId: 'col-3',
    })
    expect(out.backlogPriorStatus).toBe('IN_PROGRESS')
    expect(out.backlogPriorProgress).toBe(60)
    expect(out.backlogPriorCustomStatusId).toBe('col-3')
  })

  it('clears the live state so the card leaves the board', () => {
    const out = resolveBacklogEntry({
      status: 'IN_REVIEW',
      progressPercentage: 90,
      customStatusId: 'col-9',
    })
    expect(out.status).toBe('BACKLOG')
    expect(out.progressPercentage).toBe(0)
    expect(out.customStatusId).toBeNull()
  })

  it('does not overwrite a good snapshot when already archived', () => {
    // Re-archiving would otherwise record BACKLOG/0 and lose the real origin
    // for good — the failure mode this whole module exists to prevent.
    const out = resolveBacklogEntry({
      status: 'BACKLOG',
      progressPercentage: 0,
      customStatusId: null,
    })
    expect(out.backlogPriorStatus).toBeNull()
    expect(out.backlogPriorProgress).toBeNull()
  })
})

describe('resolveBacklogRestore', () => {
  it('restores the captured status, progress and column', () => {
    const out = resolveBacklogRestore({
      backlogPriorStatus: 'IN_PROGRESS',
      backlogPriorProgress: 60,
      backlogPriorCustomStatusId: 'col-3',
    })
    expect(out.status).toBe('IN_PROGRESS')
    expect(out.progressPercentage).toBe(60)
    expect(out.customStatusId).toBe('col-3')
  })

  it('clears the snapshot so the next archive starts fresh', () => {
    const out = resolveBacklogRestore({
      backlogPriorStatus: 'COMPLETED',
      backlogPriorProgress: 100,
      backlogPriorCustomStatusId: null,
    })
    expect(out.backlogPriorStatus).toBeNull()
    expect(out.backlogPriorProgress).toBeNull()
    expect(out.backlogPriorCustomStatusId).toBeNull()
  })

  it('falls back to To Do at 0% for tasks archived before snapshots existed', () => {
    const out = resolveBacklogRestore({})
    expect(out.status).toBe('TODO')
    expect(out.progressPercentage).toBe(0)
    expect(out.customStatusId).toBeNull()
  })

  it('treats 0% progress as a real value, not a missing one', () => {
    // ?? not || — a task genuinely archived at 0% must not be confused with
    // one that has no snapshot.
    const out = resolveBacklogRestore({
      backlogPriorStatus: 'TODO',
      backlogPriorProgress: 0,
      backlogPriorCustomStatusId: 'col-1',
    })
    expect(out.progressPercentage).toBe(0)
    expect(out.customStatusId).toBe('col-1')
  })
})

describe('leavesBacklogExplicitly', () => {
  it('detects dragging an archived card straight onto a column', () => {
    expect(leavesBacklogExplicitly('BACKLOG', 'IN_PROGRESS')).toBe(true)
  })

  it('is false when no status change is requested', () => {
    expect(leavesBacklogExplicitly('BACKLOG', undefined)).toBe(false)
  })

  it('is false when the task was never in the backlog', () => {
    expect(leavesBacklogExplicitly('TODO', 'IN_PROGRESS')).toBe(false)
  })

  it('is false when staying in the backlog', () => {
    expect(leavesBacklogExplicitly('BACKLOG', 'BACKLOG')).toBe(false)
  })
})
