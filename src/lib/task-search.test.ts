import { describe, it, expect } from 'vitest'
import { taskMatchesSearch, ticketMatches, ticketSearchConditions } from './task-search'

describe('ticketMatches', () => {
  it.each(['OPS-14', 'ops-14', 'OPS14', 'ops 14', '#14', '14', ' #14 ', 'OPS'])('finds OPS-14 from "%s"', (q) => {
    expect(ticketMatches('OPS-14', q)).toBe(true)
  })

  it('matches a bare number exactly, not as a prefix', () => {
    expect(ticketMatches('OPS-140', '14')).toBe(false)
    expect(ticketMatches('OPS-114', '#14')).toBe(false)
  })

  it('is false for a task without a ticket number', () => {
    expect(ticketMatches(null, 'OPS-14')).toBe(false)
  })
})

describe('taskMatchesSearch', () => {
  const task = {
    title: 'Fix login page',
    description: 'Button misaligned',
    ticketNumber: 'WEB-7',
    assignee: { name: 'Ana Cruz', email: 'ana@example.com' },
    assignees: [{ user: { name: 'Ben Uy', email: 'ben@example.com' } }],
  }

  it('matches the ticket number (the reported gap)', () => {
    expect(taskMatchesSearch(task, 'WEB-7')).toBe(true)
    expect(taskMatchesSearch(task, '#7')).toBe(true)
  })

  it('still matches title, description and people', () => {
    for (const q of ['login', 'MISALIGNED', 'ana cruz', 'ben@example']) {
      expect(taskMatchesSearch(task, q)).toBe(true)
    }
  })

  it('rejects unrelated text, and passes everything for an empty query', () => {
    expect(taskMatchesSearch(task, 'payroll')).toBe(false)
    expect(taskMatchesSearch(task, '  ')).toBe(true)
  })
})

describe('ticketSearchConditions', () => {
  it('turns a bare number into a sequence match', () => {
    expect(ticketSearchConditions('#14')).toEqual([{ ticketNumber: { endsWith: '-14' } }])
  })

  it('adds the canonical spelling for a compact ticket', () => {
    expect(ticketSearchConditions('ops14')).toContainEqual({ ticketNumber: { equals: 'OPS-14' } })
  })

  it('is empty for an empty query', () => {
    expect(ticketSearchConditions(' # ')).toEqual([])
  })
})
