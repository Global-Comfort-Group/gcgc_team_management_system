import { describe, it, expect, vi } from 'vitest'
import { mentionableUserIds } from './mention-scope'

const makeDb = (task: any, board: any = null, teamMembers: Record<string, string[]> = {}) => ({
  task: { findUnique: vi.fn(async () => task) },
  kanbanBoard: { findUnique: vi.fn(async () => board) },
  teamMember: {
    findMany: vi.fn(async ({ where }: any) => (teamMembers[where.teamId] ?? []).map((userId) => ({ userId }))),
  },
})

const baseTask = {
  creatorId: 'creator', assigneeId: null, teamId: null, boardId: null,
  assignees: [], teamMembers: [], collaborators: [], parent: null,
}

describe('mentionableUserIds', () => {
  it('is empty for a missing task', async () => {
    expect((await mentionableUserIds(makeDb(null) as never, 't')).size).toBe(0)
  })

  it("covers the board's owner, explicit members and team, plus the task's people", async () => {
    const db = makeDb(
      { ...baseTask, boardId: 'b1', assigneeId: 'worker', collaborators: [{ userId: 'collab' }] },
      { ownerId: 'owner', teamId: 'team1', members: [{ userId: 'guest' }] },
      { team1: ['lead', 'member'], other: ['outsider'] },
    )
    const ids = await mentionableUserIds(db as never, 't')
    expect(Array.from(ids).sort()).toEqual(['collab', 'creator', 'guest', 'lead', 'member', 'owner', 'worker'])
    expect(ids.has('outsider')).toBe(false)
  })

  it("uses the parent's board for a subtask", async () => {
    const db = makeDb(
      { ...baseTask, parent: { boardId: 'pb', teamId: null } },
      { ownerId: 'owner', teamId: 'team1', members: [] },
      { team1: ['lead'] },
    )
    const ids = await mentionableUserIds(db as never, 't')
    expect(db.kanbanBoard.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pb' } }))
    expect(ids.has('lead')).toBe(true)
  })

  it("falls back to the task's team when it is on no board", async () => {
    const db = makeDb({ ...baseTask, teamId: 'team2' }, null, { team2: ['mate'] })
    const ids = await mentionableUserIds(db as never, 't')
    expect(Array.from(ids).sort()).toEqual(['creator', 'mate'])
    expect(db.kanbanBoard.findUnique).not.toHaveBeenCalled()
  })
})
