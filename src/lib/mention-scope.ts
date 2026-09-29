import type { PrismaClient } from '@prisma/client'

type Db = Pick<PrismaClient, 'task' | 'kanbanBoard' | 'teamMember'>

/**
 * Who may be @mentioned in a task's comments: the members of the task's team
 * board, plus anyone already on the task (field reports 2026-09 — the picker
 * used to offer every user in the system).
 *
 * "Members of the board" = the board owner, its explicit members, and the
 * members of the board's team — the same people `accessibleBoardWhere` lets in.
 * The board is the task's own, or its parent's for a subtask / cascade step.
 * A task on no board falls back to its team's members.
 *
 * Used by BOTH the mention picker (/api/users/search?taskId=) and the comment
 * notifier, so a name the picker offers is always one that gets notified.
 */
export async function mentionableUserIds(db: Db, taskId: string): Promise<Set<string>> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assigneeId: true,
      teamId: true,
      boardId: true,
      assignees: { select: { userId: true } },
      teamMembers: { select: { userId: true } },
      collaborators: { select: { userId: true } },
      parent: { select: { boardId: true, teamId: true } },
    },
  })
  if (!task) return new Set()

  const ids = new Set<string>()
  const add = (id: string | null | undefined) => { if (id) ids.add(id) }
  add(task.creatorId)
  add(task.assigneeId)
  task.assignees.forEach((a) => add(a.userId))
  task.teamMembers.forEach((m) => add(m.userId))
  task.collaborators.forEach((c) => add(c.userId))

  const boardId = task.boardId ?? task.parent?.boardId ?? null
  let teamId = task.teamId ?? task.parent?.teamId ?? null
  if (boardId) {
    const board = await db.kanbanBoard.findUnique({
      where: { id: boardId },
      select: { ownerId: true, teamId: true, members: { select: { userId: true } } },
    })
    if (board) {
      add(board.ownerId)
      board.members.forEach((m) => add(m.userId))
      teamId = board.teamId ?? teamId
    }
  }
  if (teamId) {
    const members = await db.teamMember.findMany({ where: { teamId }, select: { userId: true } })
    members.forEach((m) => add(m.userId))
  }
  return ids
}
