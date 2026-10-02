import { describe, it, expect } from 'vitest'
import { parseTaskRows, parseDateCell, type ImportContext } from './task-import'

const ctx: ImportContext = {
  statuses: [
    { id: 's-todo', name: 'To Do', category: 'TODO', isDefault: true },
    { id: 's-qa', name: 'QA', category: 'IN_REVIEW', isDefault: false },
  ],
  fields: [
    { id: 'f-site', name: 'Site', type: 'SELECT', options: ['Manila', 'Cebu'], required: false },
    { id: 'f-cost', name: 'Cost', type: 'NUMBER', options: [], required: false },
  ],
  people: [
    { id: 'u-ana', name: 'Ana Cruz', email: 'ana@x.com' },
    { id: 'u-ben', name: 'Ben Uy', email: 'ben@x.com' },
    { id: 'u-b2', name: 'Ben Uy', email: 'ben2@x.com' },
  ],
}

// Exactly the export's header row.
const EXPORT_HEADER = ['Ticket', 'Title', 'Status', 'Board', 'Assignees', 'Priority', 'Start Date', 'Due Date', 'Progress %', 'Created', 'Site', 'Cost']

describe('parseTaskRows', () => {
  it('reads an exported file back, ignoring Ticket / Board / Created', () => {
    const p = parseTaskRows(EXPORT_HEADER, [
      ['OPS-4', 'Fix pump', 'QA', 'Ops', 'Ana Cruz, ben2@x.com', 'High', '2026-10-01', '2026-10-10', 40, '2026-09-01', 'cebu', '1200'],
    ], ctx)
    expect(p.ignored).toEqual(['Ticket', 'Board', 'Created'])
    expect(p.missingRequired).toEqual([])
    expect(p.rows[0].errors).toEqual([])
    expect(p.rows[0].task).toEqual({
      title: 'Fix pump', priority: 'HIGH', status: 'IN_REVIEW', customStatusId: 's-qa',
      startDate: '2026-10-01', dueDate: '2026-10-10', progressPercentage: 40,
      assigneeIds: ['u-ana', 'u-b2'],
      fieldValues: [{ fieldId: 'f-site', value: 'Cebu' }, { fieldId: 'f-cost', value: '1200' }],
    })
  })

  it('reports a missing Title or Due Date column up front', () => {
    expect(parseTaskRows(['Name', 'When'], [], ctx).missingRequired).toEqual(['Title', 'Due Date'])
  })

  it('blocks rows without a title or deadline, and bad dates', () => {
    const p = parseTaskRows(['Title', 'Due Date', 'Start Date'], [
      ['', '2026-10-10', ''],
      ['No deadline', '', ''],
      ['Bad', 'tomorrow', ''],
      ['Backwards', '2026-10-01', '2026-10-05'],
    ], ctx)
    expect(p.rows.map((r) => r.errors.length > 0)).toEqual([true, true, true, true])
    expect(p.rows.every((r) => !r.task)).toBe(true)
    expect(p.rows.map((r) => r.row)).toEqual([2, 3, 4, 5])
  })

  it('warns but still imports on unknown status/priority/people', () => {
    const p = parseTaskRows(['Title', 'Due Date', 'Status', 'Priority', 'Assignees'], [
      ['T', '2026-10-10', 'Parked', 'Critical', 'Ben Uy; zed@x.com'],
    ], ctx)
    const r = p.rows[0]
    expect(r.task).toMatchObject({ status: 'TODO', priority: 'MEDIUM', assigneeIds: [] })
    expect(r.warnings).toHaveLength(4) // status, priority, ambiguous Ben Uy, unknown zed
  })

  it('skips blank lines and matches headers in any order or case', () => {
    const p = parseTaskRows(['due date', 'TITLE'], [['2026-10-10', 'A'], [null, ''], ['2026-10-11', 'B']], ctx)
    expect(p.rows.map((r) => r.title)).toEqual(['A', 'B'])
    expect(p.rows[1].row).toBe(4)
  })

  it('enforces required custom fields', () => {
    const strict = { ...ctx, fields: [{ ...ctx.fields[0], required: true }] }
    expect(parseTaskRows(['Title', 'Due Date'], [['A', '2026-10-10']], strict).rows[0].errors).toEqual(['Site is required on this board.'])
  })
})

describe('parseDateCell', () => {
  it('reads Excel dates, serials, ISO and month-first text', () => {
    expect(parseDateCell(new Date(Date.UTC(2026, 9, 10)))).toBe('2026-10-10')
    expect(parseDateCell(46305)).toBe('2026-10-10')
    expect(parseDateCell('2026/10/10')).toBe('2026-10-10')
    expect(parseDateCell('10/10/2026')).toBe('2026-10-10')
    expect(parseDateCell('2/30/2026')).toBeNull()
    expect(parseDateCell('soon')).toBeNull()
  })
})
