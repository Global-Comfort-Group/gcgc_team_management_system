import type { UserRole, TeamMemberRole } from '@prisma/client'

/**
 * Per-board custom roles.
 *
 * Three role systems already exist — `User.role` (global), `TeamMember.role`
 * (per team), and `BoardReviewer` (who may approve). Board roles are a fourth,
 * and they **layer on top rather than replacing any of them**. Replacing
 * `TeamMember.role` would touch permission checks across 132 API routes and
 * need a data migration, for no capability the layered model doesn't already
 * give.
 *
 * The layering rule: effective permission = existing checks **OR** board-role
 * grants. Roles can only grant, never revoke. That makes the feature strictly
 * additive — a board with no roles behaves exactly as it did before this
 * existed, which is the property that matters when shipping access control to a
 * system already in use.
 */

/** The capabilities a board role can grant. */
export interface BoardPermissions {
  canCreateTask: boolean
  canEditAnyTask: boolean
  canDeleteTask: boolean
  canChangeStatus: boolean
  canApprove: boolean
  canManageBoard: boolean
}

export const NO_PERMISSIONS: BoardPermissions = {
  canCreateTask: false,
  canEditAnyTask: false,
  canDeleteTask: false,
  canChangeStatus: false,
  canApprove: false,
  canManageBoard: false,
}

const ALL_PERMISSIONS: BoardPermissions = {
  canCreateTask: true,
  canEditAnyTask: true,
  canDeleteTask: true,
  canChangeStatus: true,
  canApprove: true,
  canManageBoard: true,
}

export const PERMISSION_KEYS = Object.keys(NO_PERMISSIONS) as (keyof BoardPermissions)[]

export interface BoardRoleLite extends BoardPermissions {
  id: string
  name: string
}

export interface ResolveInput {
  userId: string
  /** Global role. ADMIN bypasses everything. */
  userRole: UserRole | null | undefined
  board: { ownerId: string | null }
  /** The user's role in the board's team, when the board belongs to one. */
  teamMemberRole?: TeamMemberRole | null
  /** Board roles this user holds. */
  roles?: BoardRoleLite[]
}

/**
 * What this person may do on this board.
 *
 * **Board-level capability, not a per-task override.** In particular
 * `canApprove` means "may act as an approver here" — it does NOT lift the
 * per-task rule that someone cannot approve their own work. The existing per-task checks still run after
 * this and still decide "may they do it to *this* task".
 */
export function resolveBoardPermissions(input: ResolveInput): BoardPermissions {
  const { userId, userRole, board, teamMemberRole, roles = [] } = input

  // 1. Admins bypass everything.
  if (userRole === 'ADMIN') return { ...ALL_PERMISSIONS }

  // 2. The board owner and any team LEADER keep full control regardless of what
  //    roles exist. This is what guarantees a board can never be locked away
  //    from the people responsible for it.
  if ((board.ownerId && board.ownerId === userId) || teamMemberRole === 'LEADER') {
    return { ...ALL_PERMISSIONS }
  }

  // 3. Otherwise: the union of every role the user holds. Grants only.
  const out = { ...NO_PERMISSIONS }
  for (const role of roles) {
    for (const key of PERMISSION_KEYS) {
      if (role[key]) out[key] = true
    }
  }

  return out
}

export type RoleChange =
  | { action: 'delete'; roleId: string }
  | { action: 'update'; roleId: string; canManageBoard: boolean }
  | { action: 'unassign'; roleId: string; userId: string }

interface RoleWithHolders extends BoardPermissions {
  id: string
  holderIds: string[]
}

/**
 * Would this change leave the board with nobody able to administer it?
 *
 * The same class of invariant as `wouldLeaveTeamLeaderless`: a board whose last
 * `canManageBoard` grant is removed can never be configured again. Boards with
 * an owner or a team leader satisfy this inherently, so in practice it only
 * bites on boards administered purely through custom roles.
 */
export function wouldLeaveBoardUnmanageable(
  roles: RoleWithHolders[],
  change: RoleChange,
  opts: { hasStandingAdmin: boolean }
): boolean {
  // An owner or team leader can always get back in, so nothing can lock it.
  if (opts.hasStandingAdmin) return false

  const after = roles
    .filter(r => !(change.action === 'delete' && r.id === change.roleId))
    .map(r => {
      if (change.action === 'update' && r.id === change.roleId) {
        return { ...r, canManageBoard: change.canManageBoard }
      }
      if (change.action === 'unassign' && r.id === change.roleId) {
        return { ...r, holderIds: r.holderIds.filter(u => u !== change.userId) }
      }
      return r
    })

  // Someone must still hold a role that grants management.
  return !after.some(r => r.canManageBoard && r.holderIds.length > 0)
}

/**
 * What happens when a task is addressed to a role.
 *
 * Every holder is assigned (field report 2026-09 — it used to wait for one of
 * them to claim it, which left work sitting unowned). The first holder is the
 * owner (`assigneeId`); the rest join as co-assignees. None means the task would
 * be invisible to everyone, which is worse than an error at creation.
 */
export type RoleAddressOutcome =
  | { kind: 'assign'; userIds: string[] }
  | { kind: 'reject'; reason: string }

export function resolveRoleAddressing(
  role: { name: string; holderIds: string[] } | null | undefined
): RoleAddressOutcome {
  if (!role) return { kind: 'reject', reason: 'That role no longer exists on this board.' }
  if (role.holderIds.length === 0) {
    return {
      kind: 'reject',
      reason: `No one holds the "${role.name}" role on this board yet, so the task would reach nobody.`,
    }
  }
  return { kind: 'assign', userIds: Array.from(new Set(role.holderIds)) }
}
