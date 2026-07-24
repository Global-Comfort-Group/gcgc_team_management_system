import { describe, it, expect } from 'vitest'
import { resolveReviewerGate } from './board-reviewer'

// Legacy result used when the board has no reviewer pool (feature off for it).
const legacy = { legacyCanFinalize: true, legacyCanRate: true }

describe('resolveReviewerGate', () => {
  it('passes through legacy permissions when the board has no reviewer pool', () => {
    expect(
      resolveReviewerGate({
        hasReviewerPool: false,
        reviewerId: null,
        viewerId: 'u1',
        isAdmin: false,
        legacyCanFinalize: true,
        legacyCanRate: false,
      })
    ).toEqual({ canFinalize: true, canRate: false })

    expect(
      resolveReviewerGate({
        hasReviewerPool: false,
        reviewerId: 'u2',
        viewerId: 'u1',
        isAdmin: false,
        legacyCanFinalize: false,
        legacyCanRate: false,
      })
    ).toEqual({ canFinalize: false, canRate: false })
  })

  it('with a pool, only the assigned reviewer may finalize + rate', () => {
    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: 'reviewer',
        viewerId: 'reviewer',
        isAdmin: false,
        ...legacy,
      })
    ).toEqual({ canFinalize: true, canRate: true })
  })

  it('with a pool, a non-reviewer leader cannot finalize or rate (even if legacy allowed it)', () => {
    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: 'reviewer',
        viewerId: 'someLeader',
        isAdmin: false,
        ...legacy,
      })
    ).toEqual({ canFinalize: false, canRate: false })
  })

  it('with a pool, the worker cannot approve their own task (blocked unless they are the reviewer)', () => {
    // viewer is the assignee/creator (legacy would let them complete) but not the reviewer
    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: 'reviewer',
        viewerId: 'worker',
        isAdmin: false,
        legacyCanFinalize: true,
        legacyCanRate: true,
      })
    ).toEqual({ canFinalize: false, canRate: false })
  })

  it('with a pool but no reviewer assigned yet, non-admins cannot finalize', () => {
    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: null,
        viewerId: 'someLeader',
        isAdmin: false,
        ...legacy,
      })
    ).toEqual({ canFinalize: false, canRate: false })
  })

  it('admin always retains override (with a pool, assigned or not)', () => {
    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: null,
        viewerId: 'admin',
        isAdmin: true,
        legacyCanFinalize: false,
        legacyCanRate: false,
      })
    ).toEqual({ canFinalize: true, canRate: true })

    expect(
      resolveReviewerGate({
        hasReviewerPool: true,
        reviewerId: 'reviewer',
        viewerId: 'admin',
        isAdmin: true,
        legacyCanFinalize: false,
        legacyCanRate: false,
      })
    ).toEqual({ canFinalize: true, canRate: true })
  })
})
