import { describe, it, expect } from 'vitest'
import { accessibleBoardWhere } from './board-access'

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
