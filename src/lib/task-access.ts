import { prisma } from '@/lib/prisma'

/**
 * Authorization helper for task sub-resources (dependencies, procurement,
 * attachments, etc.).
 *
 * "Involved in a task" = the creator, the assigner, any assignee (the flat
 * TaskAssignee list and the legacy assigneeId), any team member, or any
 * collaborator. Admins always pass.
 *
 * Returns the looked-up task (or null when it doesn't exist) plus whether the
 * given user is involved, so callers can answer 404-vs-403 correctly.
 */
export async function getTaskInvolvement(
  taskId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ task: { id: string } | null; involved: boolean }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      assignedById: true,
      assignees: { select: { userId: true } },
      teamMembers: { select: { userId: true } },
      collaborators: { select: { userId: true } },
    },
  })
  if (!task) return { task: null, involved: false }
  const involved =
    isAdmin ||
    task.creatorId === userId ||
    task.assigneeId === userId ||
    task.assignedById === userId ||
    task.assignees.some((a) => a.userId === userId) ||
    task.teamMembers.some((m) => m.userId === userId) ||
    task.collaborators.some((c) => c.userId === userId)
  return { task: { id: task.id }, involved }
}

/**
 * May this user SEE the task's sub-resources (attachments, dependencies,
 * procurement)? Wider than getTaskInvolvement, and deliberately read-only.
 *
 * Board members open each other's task cards all the time. Requiring task
 * involvement for reads made the task modal fire 403s for anyone who wasn't on
 * that specific task, and attachment previews failed with "Forbidden" — the
 * card was visible, its contents were not. Reads now also pass for anyone who
 * can reach the task's board (owner, explicit board member, member of the
 * board's team, or a holder of one of its roles), or who holds the role the
 * task is addressed to. Subtasks and cascade steps usually carry no boardId of
 * their own, so the parent's board is used for them.
 *
 * Writes keep using getTaskInvolvement: the June 2026 audit tightened those on
 * purpose, and seeing a task is not the same as being allowed to change it.
 */
export async function canViewTask(
  taskId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ task: { id: string } | null; allowed: boolean }> {
  const { task, involved } = await getTaskInvolvement(taskId, userId, isAdmin)
  if (!task) return { task: null, allowed: false }
  if (involved) return { task, allowed: true }

  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      boardId: true,
      assignedRole: { select: { assignments: { where: { userId }, select: { id: true } } } },
      parent: {
        select: {
          boardId: true,
          creatorId: true,
          assigneeId: true,
          assignees: { where: { userId }, select: { userId: true } },
        },
      },
    },
  })
  if (!t) return { task, allowed: false }

  // Holder of the role this task is addressed to.
  if (t.assignedRole && t.assignedRole.assignments.length > 0) return { task, allowed: true }

  // Involved in the parent task (subtask / cascade step case).
  if (t.parent && (t.parent.creatorId === userId || t.parent.assigneeId === userId || t.parent.assignees.length > 0)) {
    return { task, allowed: true }
  }

  const boardId = t.boardId ?? t.parent?.boardId ?? null
  if (!boardId) return { task, allowed: false }

  const reachable = await prisma.kanbanBoard.count({
    where: {
      id: boardId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
        { team: { members: { some: { userId } } } },
        { roles: { some: { assignments: { some: { userId } } } } },
      ],
    },
  })
  return { task, allowed: reachable > 0 }
}
