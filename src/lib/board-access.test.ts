import { describe, it, expect, vi } from 'vitest'
import { accessibleBoardWhere, userCanAccessBoard } from './board-access'

describe('accessibleBoardWhere', () => {
  it('grants access via ownership, explicit membership, or the board team', () => {
    const where = accessibleBoardWhere('user-1')
    expect(where.OR).toEqual([
      { ownerId: 'user-1' },
      { members: { some: { userId: 'user-1' } } },
      { team: { members: { some: { userId: 'user-1' } } } },
    ])
  })

  it('scopes every branch to the given user id', () => {
    const where = accessibleBoardWhere('user-2')
    const ids = JSON.stringify(where.OR)
    expect(ids).not.toContain('user-1')
    expect((where.OR as unknown[]).length).toBe(3)
  })
})

describe('userCanAccessBoard', () => {
  const stub = (found: boolean) => ({
    kanbanBoard: { findFirst: vi.fn(async () => (found ? { id: 'board-1' } : null)) },
  })

  it('is false for a task with no board, without querying', async () => {
    const db = stub(true)
    expect(await userCanAccessBoard(db as never, 'user-1', null)).toBe(false)
    expect(db.kanbanBoard.findFirst).not.toHaveBeenCalled()
  })

  it('asks for that board under the shared access rule', async () => {
    const db = stub(true)
    expect(await userCanAccessBoard(db as never, 'user-1', 'board-1')).toBe(true)
    expect(db.kanbanBoard.findFirst).toHaveBeenCalledWith({
      where: { id: 'board-1', ...accessibleBoardWhere('user-1') },
      select: { id: true },
    })
  })

  it('is false when the board is not one of the user’s', async () => {
    expect(await userCanAccessBoard(stub(false) as never, 'user-1', 'board-9')).toBe(false)
  })
})
