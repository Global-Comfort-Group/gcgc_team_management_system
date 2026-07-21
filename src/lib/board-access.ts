import type { Prisma } from '@prisma/client'

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
