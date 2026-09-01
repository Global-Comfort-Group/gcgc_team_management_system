import { describe, it, expect } from 'vitest'
import {
  formatTicket,
  parseTicket,
  normalisePrefix,
  derivePrefixFromName,
  counterFloorForManualTicket,
} from './ticket-number'

describe('formatTicket', () => {
  it('builds the display value', () => {
    expect(formatTicket('OPS', 14)).toBe('OPS-14')
  })
})

describe('parseTicket', () => {
  it('parses a well-formed ticket', () => {
    expect(parseTicket('OPS-14')).toEqual({ prefix: 'OPS', seq: 14 })
  })

  it('accepts lowercase and surrounding whitespace', () => {
    expect(parseTicket('  ops-14 ')).toEqual({ prefix: 'OPS', seq: 14 })
  })

  it('rejects leading zeros so a ticket has exactly one spelling', () => {
    // Otherwise OPS-01 and OPS-1 are different strings meaning the same thing.
    expect(parseTicket('OPS-01')).toBeNull()
  })

  it('rejects a prefix starting with a digit', () => {
    expect(parseTicket('1OPS-4')).toBeNull()
  })

  it('rejects sequence zero and negatives', () => {
    expect(parseTicket('OPS-0')).toBeNull()
    expect(parseTicket('OPS--1')).toBeNull()
  })

  it('rejects malformed input', () => {
    for (const v of ['', 'OPS', 'OPS-', '-14', 'OPS 14', 'OP S-14', null, undefined]) {
      expect(parseTicket(v as string)).toBeNull()
    }
  })

  it('rejects a prefix longer than the column allows', () => {
    expect(parseTicket('ABCDEFGHIJK-1')).toBeNull()   // 11 chars
    expect(parseTicket('ABCDEFGHIJ-1')).not.toBeNull() // 10 chars
  })
})

describe('normalisePrefix', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalisePrefix(' ops-team ')).toBe('OPSTEAM')
  })

  it('truncates to the column limit', () => {
    expect(normalisePrefix('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJ')
  })

  it('rejects input that would start with a digit', () => {
    expect(normalisePrefix('1ops')).toBeNull()
  })

  it('rejects input with nothing usable', () => {
    for (const v of ['', '   ', '---', null, undefined]) {
      expect(normalisePrefix(v as string)).toBeNull()
    }
  })

  it('round-trips through parseTicket', () => {
    const p = normalisePrefix('Ops Team!')!
    expect(parseTicket(formatTicket(p, 7))).toEqual({ prefix: p, seq: 7 })
  })
})

describe('derivePrefixFromName', () => {
  it('takes the first three alphanumerics', () => {
    expect(derivePrefixFromName('Operations Board', new Set())).toBe('OPE')
  })

  it('suffixes to avoid a prefix already taken', () => {
    expect(derivePrefixFromName('Operations', new Set(['OPE']))).toBe('OPE2')
  })

  it('keeps suffixing past repeated collisions', () => {
    expect(derivePrefixFromName('Operations', new Set(['OPE', 'OPE2']))).toBe('OPE3')
  })

  it('handles a short name', () => {
    expect(derivePrefixFromName('QA', new Set())).toBe('QA')
  })

  it('returns null when the name yields nothing usable', () => {
    expect(derivePrefixFromName('---', new Set())).toBeNull()
    expect(derivePrefixFromName('123', new Set())).toBeNull()
  })

  it('never exceeds the column limit even when suffixing', () => {
    const taken = new Set(['ABCDEFGHIJ'])
    const out = derivePrefixFromName('ABCDEFGHIJKLM', taken, 10)!
    expect(out.length).toBeLessThanOrEqual(10)
    expect(taken.has(out)).toBe(false)
  })
})

describe('counterFloorForManualTicket', () => {
  it('raises the counter past a manually-set high number', () => {
    // The months-later failure this prevents: counter reaches 500 and collides.
    expect(counterFloorForManualTicket('OPS-500', 'OPS', 12)).toBe(500)
  })

  it('does nothing when the counter is already ahead', () => {
    expect(counterFloorForManualTicket('OPS-5', 'OPS', 12)).toBeNull()
  })

  it('does nothing when the counter already equals the sequence', () => {
    expect(counterFloorForManualTicket('OPS-12', 'OPS', 12)).toBeNull()
  })

  it('ignores a ticket using a prefix this board does not own', () => {
    // Importing "JIRA-900" must not touch the OPS counter.
    expect(counterFloorForManualTicket('JIRA-900', 'OPS', 3)).toBeNull()
  })

  it('ignores a board with no prefix of its own', () => {
    expect(counterFloorForManualTicket('OPS-900', null, 3)).toBeNull()
  })

  it('ignores an unparseable ticket', () => {
    expect(counterFloorForManualTicket('not a ticket', 'OPS', 3)).toBeNull()
  })
})
