import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * The set of boards a user may see and post tasks to via the public API.
 *
 * Access mirrors the web app's own "in the board" model, so a token can never
 * reach a board the user couldn't reach in the UI:
 *   - boards they own,
 *   - boards they're an explicit KanbanBoardMember of, or
 *   - boards whose TEAM they belong to (board↔team is 1:1 via KanbanBoard.teamId;
 *     most boards grant access this way rather than via explicit membership).
 *
 * Used by BOTH the boards listing and the task-create board authorization so the
 * two never diverge (a board that lists must be postable, and vice versa).
 */
export function accessibleBoardWhere(userId: string): Prisma.KanbanBoardWhereInput {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
      { team: { members: { some: { userId } } } },
    ],
  }
}

/**
 * Can this user see the given board? Same rule as `accessibleBoardWhere`, asked
 * about one board.
 *
 * Used to let any member of a board see a task on it — including its subtasks
 * and cascade steps, which carry no `boardId`/`teamId` of their own and so used
 * to be visible only to the people directly named on them (field reports
 * 2026-09). The db client is passed in so this module stays free of a
 * module-level Prisma instance.
 */
export async function userCanAccessBoard(
  db: Pick<PrismaClient, 'kanbanBoard'>,
  userId: string,
  boardId: string | null | undefined,
): Promise<boolean> {
  if (!boardId) return false
  const board = await db.kanbanBoard.findFirst({
    where: { id: boardId, ...accessibleBoardWhere(userId) },
    select: { id: true },
  })
  return !!board
}

/**
 * Is this user a LEADER working in the given board?
 *
 * "All leaders in a team board can edit, update, rate and approve its tasks"
 * (field reports 2026-09). A leader counts when their account role is LEADER and
 * they can reach the board by the same rule as `accessibleBoardWhere` — owner,
 * explicit member, or member of the board's team. Their role *within* the team
 * doesn't matter: a co-leader added to a team as a plain member still leads.
 *
 * Callers pass the board that governs the task — its own, or its parent's for a
 * subtask / cascade step (those carry no boardId of their own).
 */
export async function userIsLeaderInBoard(
  db: Pick<PrismaClient, 'kanbanBoard'>,
  userId: string,
  userRole: string | null | undefined,
  boardId: string | null | undefined,
): Promise<boolean> {
  if (userRole !== 'LEADER') return false
  return userCanAccessBoard(db, userId, boardId)
}

/**
 * The ids of every board a LEADER leads in, for batch checks over many tasks
 * (the task list, bulk actions). Empty for anyone who isn't a LEADER.
 */
export async function leaderBoardIds(
  db: Pick<PrismaClient, 'kanbanBoard'>,
  userId: string,
  userRole: string | null | undefined,
): Promise<Set<string>> {
  if (userRole !== 'LEADER') return new Set()
  const boards = await db.kanbanBoard.findMany({
    where: accessibleBoardWhere(userId),
    select: { id: true },
  })
  return new Set(boards.map(b => b.id))
}
