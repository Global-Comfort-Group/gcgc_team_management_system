import { describe, it, expect } from 'vitest'
import { annotateMemberSource, type LeaderRoster } from './leader-roster'

function roster(overrides: Partial<LeaderRoster> = {}): LeaderRoster {
  return {
    memberIds: [],
    hierarchyIds: new Set(),
    teamsByUser: new Map(),
    managedTeams: [],
    ...overrides,
  }
}

describe('annotateMemberSource', () => {
  it('tags a reports-to member', () => {
    const r = roster({ hierarchyIds: new Set(['u1']) })
    expect(annotateMemberSource({ id: 'u1' }, r)).toEqual({
      id: 'u1',
      sources: ['reports-to'],
      teams: [],
    })
  })

  it('tags someone who is only on a team the leader manages', () => {
    // The reported bug: adding a member to a team you created never touches
    // reports-to, so they were absent from Member Management entirely.
    const r = roster({
      teamsByUser: new Map([['u2', [{ id: 't1', name: 'Ops' }]]]),
    })
    expect(annotateMemberSource({ id: 'u2' }, r)).toEqual({
      id: 'u2',
      sources: ['team'],
      teams: [{ id: 't1', name: 'Ops' }],
    })
  })

  it('reports both sources when a person is in each', () => {
    const r = roster({
      hierarchyIds: new Set(['u3']),
      teamsByUser: new Map([['u3', [{ id: 't1', name: 'Ops' }]]]),
    })
    expect(annotateMemberSource({ id: 'u3' }, r).sources).toEqual(['reports-to', 'team'])
  })

  it('lists every managed team a person belongs to', () => {
    const r = roster({
      teamsByUser: new Map([[
        'u4',
        [{ id: 't1', name: 'Ops' }, { id: 't2', name: 'Launch' }],
      ]]),
    })
    expect(annotateMemberSource({ id: 'u4' }, r).teams).toHaveLength(2)
  })

  it('preserves the loaded user fields it wraps', () => {
    const r = roster({ hierarchyIds: new Set(['u5']) })
    const out = annotateMemberSource({ id: 'u5', email: 'a@b.c', name: 'Ann' }, r)
    expect(out.email).toBe('a@b.c')
    expect(out.name).toBe('Ann')
  })

  it('leaves an unrelated user with no source', () => {
    expect(annotateMemberSource({ id: 'u6' }, roster()).sources).toEqual([])
  })
})
