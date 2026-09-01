import { describe, it, expect } from 'vitest'
import { splitDuplicatedChildren } from './duplicate-prefill'

const steps = [
  { id: 'c', title: 'Third', cascadeOrder: 3 },
  { id: 'a', title: 'First', cascadeOrder: 1 },
  { id: 'b', title: 'Second', cascadeOrder: 2 },
]

describe('splitDuplicatedChildren', () => {
  it('routes a cascading task\'s children to cascadeSteps so the form shows them', () => {
    // The reported bug: these landed in pendingSubtasks, which the cascading UI
    // never renders — so creation looked empty but the task came out with steps.
    const out = splitDuplicatedChildren(steps, true)
    expect(out.cascadeSteps).toHaveLength(3)
    expect(out.pendingSubtasks).toEqual([])
  })

  it('orders cascade steps by cascadeOrder, not array order', () => {
    const out = splitDuplicatedChildren(steps, true)
    expect(out.cascadeSteps.map(s => s.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('routes an ordinary task\'s children to pendingSubtasks', () => {
    const out = splitDuplicatedChildren(
      [{ id: 'x', title: 'Sub A' }, { id: 'y', title: 'Sub B' }],
      false
    )
    expect(out.pendingSubtasks).toHaveLength(2)
    expect(out.cascadeSteps).toEqual([])
  })

  it('never populates both lists — that would create every child twice', () => {
    for (const cascading of [true, false]) {
      const out = splitDuplicatedChildren(steps, cascading)
      const bothPopulated = out.cascadeSteps.length > 0 && out.pendingSubtasks.length > 0
      expect(bothPopulated).toBe(false)
    }
  })

  it('sorts steps without an order last, keeping their relative position', () => {
    const out = splitDuplicatedChildren(
      [{ title: 'No order A' }, { title: 'Ordered', cascadeOrder: 1 }, { title: 'No order B' }],
      true
    )
    expect(out.cascadeSteps.map(s => s.title)).toEqual(['Ordered', 'No order A', 'No order B'])
  })

  it('carries assignee and due date across', () => {
    const out = splitDuplicatedChildren(
      [{ title: 'S', assignee: { id: 'u1', email: 'a@b.c' }, dueDate: '2026-09-01T00:00:00Z' }],
      false
    )
    expect(out.pendingSubtasks[0].assigneeId).toBe('u1')
    expect(out.pendingSubtasks[0].dueDate).toBe('2026-09-01T00:00:00Z')
  })

  it('falls back to assigneeId when the assignee object is absent', () => {
    const out = splitDuplicatedChildren([{ title: 'S', assigneeId: 'u9' }], false)
    expect(out.pendingSubtasks[0].assigneeId).toBe('u9')
  })

  it('handles no subtasks at all', () => {
    expect(splitDuplicatedChildren([], true)).toEqual({ cascadeSteps: [], pendingSubtasks: [] })
    expect(splitDuplicatedChildren(undefined, true)).toEqual({ cascadeSteps: [], pendingSubtasks: [] })
    expect(splitDuplicatedChildren(null, false)).toEqual({ cascadeSteps: [], pendingSubtasks: [] })
  })
})
