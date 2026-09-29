import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  resolveBoardPermissions,
  wouldLeaveBoardUnmanageable,
  type BoardPermissions,
  type RoleChange,
} from '@/lib/board-roles'

/**
 * Server-side plumbing for board roles: load everything the pure resolver in
 * `board-roles.ts` needs, in one query, and expose the guards routes share.
 *
 * Routes call this rather than assembling their own checks — the same
 * one-source-of-truth reason `task-scope.ts` exists after the dashboard drifted
 * from the Tasks tab. A second implementation of a permission rule is a second
 * place for it to be wrong.
 */

export interface BoardRoleContext {
  board: { id: string; ownerId: string; teamId: string | null }
  permissions: BoardPermissions
  /** True if the user is owner/team-leader/admin — someone who can always get back in. */
  hasStandingAdmin: boolean
}

/**
 * Load a board and resolve what `userId` may do on it, or null when the board
 * doesn't exist or the user cannot reach it at all.
 *
 * Reachability mirrors `accessibleBoardWhere`: owner, explicit board member, or
 * a member of the board's team. Holding a board role also counts — otherwise
 * granting someone a role would not let them see the board it belongs to.
 */
export async function loadBoardRoleContext(
  boardId: string,
  userId: string,
  userRole: UserRole | null | undefined
): Promise<BoardRoleContext | null> {
  const board = await prisma.kanbanBoard.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      ownerId: true,
      teamId: true,
      members: { where: { userId }, select: { id: true } },
      team: { select: { members: { where: { userId }, select: { role: true } } } },
      roles: {
        where: { assignments: { some: { userId } } },
        select: {
          id: true, name: true,
          canCreateTask: true, canEditAnyTask: true, canDeleteTask: true,
          canChangeStatus: true, canApprove: true, canManageBoard: true,
        },
      },
    },
  })
  if (!board) return null

  const isAdmin = userRole === 'ADMIN'
  const teamMemberRole = board.team?.members[0]?.role ?? null
  const reachable =
    isAdmin ||
    board.ownerId === userId ||
    board.members.length > 0 ||
    !!teamMemberRole ||
    board.roles.length > 0
  if (!reachable) return null

  const permissions = resolveBoardPermissions({
    userId,
    userRole,
    board: { ownerId: board.ownerId },
    teamMemberRole,
    roles: board.roles,
  })

  return {
    board: { id: board.id, ownerId: board.ownerId, teamId: board.teamId },
    permissions,
    hasStandingAdmin: isAdmin || board.ownerId === userId || teamMemberRole === 'LEADER',
  }
}

/**
 * Guard for role-management endpoints. Returns a response to send when the user
 * may not manage the board, or null to proceed.
 */
export async function requireManageBoard(
  boardId: string,
  userId: string,
  userRole: UserRole | null | undefined
): Promise<NextResponse | null> {
  const ctx = await loadBoardRoleContext(boardId, userId, userRole)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.permissions.canManageBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/**
 * Reject a change that would leave the board with nobody able to administer it.
 * Returns a response to send, or null when the change is safe.
 *
 * Boards with an owner or a team leader can never be locked, so this only bites
 * on boards administered purely through custom roles — but there it is the
 * difference between a configurable board and a permanently frozen one.
 */
export async function guardBoardManageability(
  boardId: string,
  change: RoleChange,
  hasStandingAdmin: boolean
): Promise<NextResponse | null> {
  const roles = await prisma.boardRole.findMany({
    where: { boardId },
    select: {
      id: true,
      canCreateTask: true, canEditAnyTask: true, canDeleteTask: true,
      canChangeStatus: true, canApprove: true, canManageBoard: true,
      assignments: { select: { userId: true } },
    },
  })

  const shaped = roles.map(r => ({
    id: r.id,
    canCreateTask: r.canCreateTask,
    canEditAnyTask: r.canEditAnyTask,
    canDeleteTask: r.canDeleteTask,
    canChangeStatus: r.canChangeStatus,
    canApprove: r.canApprove,
    canManageBoard: r.canManageBoard,
    holderIds: r.assignments.map(a => a.userId),
  }))

  if (wouldLeaveBoardUnmanageable(shaped, change, { hasStandingAdmin })) {
    return NextResponse.json(
      { error: 'This would leave the board with no one able to manage it.' },
      { status: 409 }
    )
  }
  return null
}
