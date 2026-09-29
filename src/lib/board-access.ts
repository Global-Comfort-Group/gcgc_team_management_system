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
