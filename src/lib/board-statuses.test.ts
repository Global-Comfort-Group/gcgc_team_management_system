import { describe, it, expect } from 'vitest'
import { planDefaultStatusRepair, needsDefaultStatusRepair, pickReplacementDefault } from './board-statuses'

const row = (id: string, category: any, isDefault: boolean, position: number, name = id) =>
  ({ id, name, category, isDefault, position })

describe('planDefaultStatusRepair', () => {
  it('creates all four defaults on a board with no statuses', () => {
    const plan = planDefaultStatusRepair([])
    expect(plan.create.map((d) => d.name)).toEqual(['To Do', 'In Progress', 'In Review', 'Completed'])
    expect(plan.promote).toEqual([])
  })

  it('restores the missing defaults around a lone custom status (the reported bug)', () => {
    const plan = planDefaultStatusRepair([row('qa', 'IN_REVIEW', false, 0, 'QA')])
    expect(plan.create.map((d) => d.category)).toEqual(['TODO', 'IN_PROGRESS', 'COMPLETED'])
    expect(plan.promote).toEqual(['qa'])
  })

  it('promotes the first status of a category that lost its default', () => {
    const plan = planDefaultStatusRepair([
      row('d1', 'TODO', true, 0), row('d2', 'IN_PROGRESS', true, 1),
      row('b', 'IN_REVIEW', false, 3), row('a', 'IN_REVIEW', false, 2),
      row('d4', 'COMPLETED', true, 4),
    ])
    expect(plan).toEqual({ create: [], promote: ['a'] })
  })

  it('leaves a fully set-up board alone', () => {
    const board = [row('1', 'TODO', true, 0), row('2', 'IN_PROGRESS', true, 1), row('3', 'IN_REVIEW', true, 2), row('4', 'COMPLETED', true, 3)]
    expect(needsDefaultStatusRepair(board)).toBe(false)
  })

  it('does not recreate a default whose name is already taken', () => {
    const plan = planDefaultStatusRepair([row('x', 'IN_PROGRESS', true, 0, 'to do')])
    expect(plan.create.map((d) => d.name)).not.toContain('To Do')
  })
})

describe('pickReplacementDefault', () => {
  it('picks the earliest other status in the same category', () => {
    const del = row('d', 'TODO', true, 0)
    const all = [del, row('late', 'TODO', false, 5), row('early', 'TODO', false, 2), row('o', 'IN_PROGRESS', true, 1)]
    expect(pickReplacementDefault(all, del)?.id).toBe('early')
  })

  it('is null when the status is the last of its category', () => {
    const del = row('d', 'TODO', true, 0)
    expect(pickReplacementDefault([del, row('o', 'IN_PROGRESS', true, 1)], del)).toBeNull()
  })
})
