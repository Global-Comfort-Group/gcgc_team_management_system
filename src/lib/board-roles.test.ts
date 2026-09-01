import { describe, it, expect } from 'vitest'
import {
  resolveBoardPermissions,
  wouldLeaveBoardUnmanageable,
  resolveRoleAddressing,
  NO_PERMISSIONS,
  PERMISSION_KEYS,
  type BoardRoleLite,
} from './board-roles'

const role = (name: string, grants: Partial<BoardRoleLite>): BoardRoleLite => ({
  id: name.toLowerCase(),
  name,
  ...NO_PERMISSIONS,
  ...grants,
})

const board = { ownerId: 'owner-1' }

describe('resolveBoardPermissions — the additive guarantee', () => {
  it('gives a plain member with no roles exactly nothing extra', () => {
    // THE regression that matters: a board with no custom roles must behave
    // precisely as it did before this feature existed.
    expect(
      resolveBoardPermissions({ userId: 'u1', userRole: 'MEMBER', board })
    ).toEqual(NO_PERMISSIONS)
  })

  it('is unchanged for a member even when roles exist that they do not hold', () => {
    expect(
      resolveBoardPermissions({ userId: 'u1', userRole: 'MEMBER', board, roles: [] })
    ).toEqual(NO_PERMISSIONS)
  })
})

describe('resolveBoardPermissions — standing authority', () => {
  it('grants an ADMIN everything', () => {
    const p = resolveBoardPermissions({ userId: 'nobody', userRole: 'ADMIN', board })
    expect(PERMISSION_KEYS.every(k => p[k])).toBe(true)
  })

  it('grants the board owner everything', () => {
    const p = resolveBoardPermissions({ userId: 'owner-1', userRole: 'MEMBER', board })
    expect(PERMISSION_KEYS.every(k => p[k])).toBe(true)
  })

  it('grants a team LEADER everything', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board, teamMemberRole: 'LEADER',
    })
    expect(PERMISSION_KEYS.every(k => p[k])).toBe(true)
  })

  it('does not elevate a team MEMBER', () => {
    expect(
      resolveBoardPermissions({ userId: 'u1', userRole: 'MEMBER', board, teamMemberRole: 'MEMBER' })
    ).toEqual(NO_PERMISSIONS)
  })
})

describe('resolveBoardPermissions — role grants', () => {
  it('grants exactly what a single role carries, nothing more', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board,
      roles: [role('QA', { canChangeStatus: true })],
    })
    expect(p.canChangeStatus).toBe(true)
    expect(p.canDeleteTask).toBe(false)
    expect(p.canManageBoard).toBe(false)
  })

  it('unions several roles held by the same person', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board,
      roles: [role('QA', { canChangeStatus: true }), role('Lead', { canDeleteTask: true })],
    })
    expect(p.canChangeStatus).toBe(true)
    expect(p.canDeleteTask).toBe(true)
  })

  it('never revokes — a role granting nothing cannot remove an existing grant', () => {
    // Roles are grant-only by construction; this pins that.
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board,
      roles: [role('Viewer', {}), role('QA', { canCreateTask: true })],
    })
    expect(p.canCreateTask).toBe(true)
  })

  it('cannot strip a team leader of anything', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board, teamMemberRole: 'LEADER',
      roles: [role('Viewer', {})],
    })
    expect(PERMISSION_KEYS.every(k => p[k])).toBe(true)
  })
})

describe('resolveBoardPermissions — approval', () => {
  it('grants approval to the reviewer pool independently of roles', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board, reviewerIds: ['u1'],
    })
    expect(p.canApprove).toBe(true)
    expect(p.canCreateTask).toBe(false)
  })

  it('a role can grant approval too', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board, roles: [role('Approver', { canApprove: true })],
    })
    expect(p.canApprove).toBe(true)
  })

  it('leaves a non-reviewer without approval', () => {
    const p = resolveBoardPermissions({
      userId: 'u1', userRole: 'MEMBER', board, reviewerIds: ['someone-else'],
    })
    expect(p.canApprove).toBe(false)
  })
})

describe('wouldLeaveBoardUnmanageable', () => {
  const managing = { ...NO_PERMISSIONS, id: 'r1', canManageBoard: true, holderIds: ['u1'] }
  const plain = { ...NO_PERMISSIONS, id: 'r2', canManageBoard: false, holderIds: ['u2'] }

  it('blocks deleting the last managing role on a board with no standing admin', () => {
    expect(
      wouldLeaveBoardUnmanageable([managing, plain], { action: 'delete', roleId: 'r1' }, { hasStandingAdmin: false })
    ).toBe(true)
  })

  it('blocks removing the last holder of the last managing role', () => {
    expect(
      wouldLeaveBoardUnmanageable([managing], { action: 'unassign', roleId: 'r1', userId: 'u1' }, { hasStandingAdmin: false })
    ).toBe(true)
  })

  it('blocks revoking canManageBoard from the last managing role', () => {
    expect(
      wouldLeaveBoardUnmanageable([managing], { action: 'update', roleId: 'r1', canManageBoard: false }, { hasStandingAdmin: false })
    ).toBe(true)
  })

  it('allows the change when an owner or team leader can still get in', () => {
    // The common case: boards with an owner can never be locked out.
    expect(
      wouldLeaveBoardUnmanageable([managing], { action: 'delete', roleId: 'r1' }, { hasStandingAdmin: true })
    ).toBe(false)
  })

  it('allows deleting one managing role when another remains held', () => {
    const second = { ...NO_PERMISSIONS, id: 'r3', canManageBoard: true, holderIds: ['u3'] }
    expect(
      wouldLeaveBoardUnmanageable([managing, second], { action: 'delete', roleId: 'r1' }, { hasStandingAdmin: false })
    ).toBe(false)
  })

  it('treats a managing role with no holders as no protection', () => {
    const empty = { ...NO_PERMISSIONS, id: 'r4', canManageBoard: true, holderIds: [] }
    expect(
      wouldLeaveBoardUnmanageable([managing, empty], { action: 'delete', roleId: 'r1' }, { hasStandingAdmin: false })
    ).toBe(true)
  })

  it('allows deleting a role that never granted management', () => {
    expect(
      wouldLeaveBoardUnmanageable([managing, plain], { action: 'delete', roleId: 'r2' }, { hasStandingAdmin: false })
    ).toBe(false)
  })
})

describe('resolveRoleAddressing', () => {
  it('auto-assigns when exactly one person holds the role', () => {
    expect(resolveRoleAddressing({ name: 'QA', holderIds: ['u1'] }))
      .toEqual({ kind: 'assign', userId: 'u1' })
  })

  it('leaves the task claimable when several hold the role', () => {
    expect(resolveRoleAddressing({ name: 'QA', holderIds: ['u1', 'u2'] }))
      .toEqual({ kind: 'unclaimed' })
  })

  it('rejects an empty role rather than creating invisible work', () => {
    const out = resolveRoleAddressing({ name: 'QA', holderIds: [] })
    expect(out.kind).toBe('reject')
    expect(out.kind === 'reject' && out.reason).toContain('QA')
  })

  it('rejects a role that no longer exists', () => {
    expect(resolveRoleAddressing(null).kind).toBe('reject')
    expect(resolveRoleAddressing(undefined).kind).toBe('reject')
  })
})
