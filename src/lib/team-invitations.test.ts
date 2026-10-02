import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/team-leader-sync', () => ({ syncTeamMembersToLeaders: vi.fn() }))
import { decideInvite, decideResponse } from './team-invitations'

describe('decideInvite', () => {
  it('sends a fresh invite to a non-member', () => {
    expect(decideInvite({ isMember: false, existing: null })).toEqual({ ok: true, reuse: false })
  })
  it('re-invites after a decline or cancel, reusing the row', () => {
    expect(decideInvite({ isMember: false, existing: { status: 'DECLINED' } })).toEqual({ ok: true, reuse: true })
    expect(decideInvite({ isMember: false, existing: { status: 'CANCELLED' } })).toEqual({ ok: true, reuse: true })
  })
  it('refuses a member, or a second pending invite', () => {
    expect(decideInvite({ isMember: true, existing: null })).toMatchObject({ ok: false, status: 400 })
    expect(decideInvite({ isMember: false, existing: { status: 'PENDING' } })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('decideResponse', () => {
  it('lets the invitee answer a pending invitation', () => {
    expect(decideResponse({ userId: 'u', status: 'PENDING' }, 'u')).toEqual({ ok: true })
  })
  it("hides someone else's invitation as not found", () => {
    expect(decideResponse({ userId: 'other', status: 'PENDING' }, 'u')).toMatchObject({ ok: false, status: 404 })
    expect(decideResponse(null, 'u')).toMatchObject({ ok: false, status: 404 })
  })
  it('refuses an invitation that was already answered or cancelled', () => {
    expect(decideResponse({ userId: 'u', status: 'CANCELLED' }, 'u')).toMatchObject({ ok: false, status: 409 })
    expect(decideResponse({ userId: 'u', status: 'ACCEPTED' }, 'u')).toMatchObject({ ok: false, status: 409 })
  })
})
