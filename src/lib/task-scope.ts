import type { Prisma } from '@prisma/client'

/**
 * Shared task-scoping helpers.
 *
 * The dashboard summary and the Tasks tab had each grown their own idea of
 * "my tasks": the dashboard counted `assigneeId` only, while `GET /api/tasks`
 * used a much wider involvement clause and excluded subtasks and recurring
 * templates. The two numbers therefore disagreed for anyone who was on a task
 * as a collaborator, a team member, or via a subtask. Both sides now build
 * their where-clause from here so they cannot drift again.
 */

/** Statuses that never represent open, actionable work. */
export const CLOSED_TASK_STATUSES = ['COMPLETED', 'CANCELLED', 'BACKLOG'] as const

/**
 * "Completed work", including completed tasks that were archived to the
 * Backlog — manually or by the 5-day auto-archive (src/lib/auto-archive.ts).
 * Counting `status: 'COMPLETED'` alone would make finished work vanish from
 * every completion figure five days after it was done.
 *
 * Contains an OR, so combine it through `AND: [...]`, never by spreading.
 */
export const COMPLETED_WORK_WHERE: Prisma.TaskWhereInput = {
  OR: [
    { status: 'COMPLETED' },
    { status: 'BACKLOG', backlogPriorStatus: 'COMPLETED' },
  ],
}

/**
 * The involvement clause `GET /api/tasks` applies for non-admins on the
 * "All Tasks" view: a user has a task if they are its assignee, its creator, a
 * listed team member or collaborator — or if one of its unlocked subtasks is
 * assigned to them (those surface via the parent card).
 *
 * Team-membership-derived tasks are deliberately NOT included: the Tasks tab
 * only widens to team tasks when a board or team filter is active, so counting
 * them here would put the summary back out of step with the list.
 */
export function taskInvolvementOr(userId: string): Prisma.TaskWhereInput[] {
  return [
    {
      OR: [
        { assigneeId: userId },
        { creatorId: userId },
        { teamMembers: { some: { userId } } },
        { collaborators: { some: { userId } } },
      ],
    },
    {
      AND: [
        { parentId: null },
        { subtasks: { some: { assigneeId: userId, isLocked: false } } },
      ],
    },
  ]
}

/**
 * Top-level, non-template tasks the user is involved in — the countable
 * equivalent of what the Tasks tab lists.
 */
export function myTasksWhere(userId: string): Prisma.TaskWhereInput {
  return {
    parentId: null,
    isRecurring: false,
    OR: taskInvolvementOr(userId),
  }
}

/**
 * Tasks belonging to any of the given teams.
 *
 * Scoped through the board as well as the task: tasks created before the
 * team↔board derivation existed have `teamId = null` even when they sit on a
 * team board, so a `task.teamId`-only filter silently drops every old task.
 */
export function teamTasksWhere(teamIds: string[]): Prisma.TaskWhereInput {
  return {
    parentId: null,
    isRecurring: false,
    OR: [
      { teamId: { in: teamIds } },
      { board: { teamId: { in: teamIds } } },
    ],
  }
}
