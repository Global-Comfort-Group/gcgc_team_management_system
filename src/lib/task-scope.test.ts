import { describe, it, expect } from 'vitest'
import { myTasksWhere, teamTasksWhere, taskInvolvementOr } from './task-scope'

describe('taskInvolvementOr', () => {
  it('covers every way a user is attached to a task', () => {
    const [core] = taskInvolvementOr('u1')
    const keys = (core.OR ?? []).map((c) => Object.keys(c as object)[0])
    expect(keys).toEqual(['assigneeId', 'creatorId', 'teamMembers', 'collaborators'])
  })

  it('surfaces the parent of an unlocked subtask assigned to the user', () => {
    const [, subtaskBranch] = taskInvolvementOr('u1')
    expect(subtaskBranch).toEqual({
      AND: [
        { parentId: null },
        { subtasks: { some: { assigneeId: 'u1', isLocked: false } } },
      ],
    })
  })

  it('does not widen to the user\'s teams', () => {
    // The Tasks tab only shows team tasks behind a board/team filter. Counting
    // them in the summary is exactly the drift this module exists to prevent.
    expect(JSON.stringify(taskInvolvementOr('u1'))).not.toContain('teamId')
  })
})

describe('myTasksWhere', () => {
  it('excludes subtasks and recurring templates', () => {
    const where = myTasksWhere('u1')
    expect(where.parentId).toBeNull()
    expect(where.isRecurring).toBe(false)
  })

  it('counts a task the user only collaborates on', () => {
    // Regression: the dashboard used to filter on assigneeId alone, so a
    // collaborator's summary read lower than their own task list.
    const json = JSON.stringify(myTasksWhere('u1'))
    expect(json).toContain('collaborators')
    expect(json).toContain('teamMembers')
    expect(json).toContain('creatorId')
  })
})

describe('teamTasksWhere', () => {
  it('matches tasks by their board team as well as their own teamId', () => {
    // Tasks predating the team↔board derivation have teamId = null even on a
    // team board; a task.teamId-only filter drops all of them.
    const where = teamTasksWhere(['t1', 't2'])
    expect(where.OR).toEqual([
      { teamId: { in: ['t1', 't2'] } },
      { board: { teamId: { in: ['t1', 't2'] } } },
    ])
  })

  it('stays scoped to top-level, non-template tasks', () => {
    const where = teamTasksWhere(['t1'])
    expect(where.parentId).toBeNull()
    expect(where.isRecurring).toBe(false)
  })
})
