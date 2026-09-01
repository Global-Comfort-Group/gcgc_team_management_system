/**
 * Task ticket numbers — the human-quotable id for a task ("OPS-14").
 *
 * Task ids are cuids (`cmti18wfd000jm35bwbqs5ioz`), which nobody can read out
 * in a meeting. A ticket number is a prefix owned by a board plus a sequence
 * number, or the global prefix for the 58% of tasks that belong to no board.
 *
 * Everything here is pure. Allocation itself is NOT — the counter increment has
 * to happen inside the create transaction, or two simultaneous creates read the
 * same value and produce a duplicate, which the unique constraint then turns
 * into a failed task creation. See `allocateTicketNumber` in the tasks route.
 */

export const MAX_PREFIX_LENGTH = 10

/** `OPS-14`. Prefix uppercase alphanumeric starting with a letter; sequence ≥ 1. */
const TICKET_RE = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/

export interface ParsedTicket {
  prefix: string
  seq: number
}

/** Build the display value. */
export function formatTicket(prefix: string, seq: number): string {
  return `${prefix}-${seq}`
}

/**
 * Parse a ticket number, or null if it isn't one.
 *
 * Deliberately strict: a lax parser would let "OPS-01" and "OPS-1" coexist as
 * different strings pointing at the same intended number, so leading zeros are
 * rejected rather than silently normalised.
 */
export function parseTicket(value: string | null | undefined): ParsedTicket | null {
  if (!value) return null
  const m = TICKET_RE.exec(value.trim().toUpperCase())
  if (!m) return null
  const seq = Number(m[2])
  if (!Number.isSafeInteger(seq) || seq < 1) return null
  // "OPS-01" parses to 1 but is not the canonical form; reject so there is
  // exactly one spelling of any given ticket.
  if (String(seq) !== m[2]) return null
  return { prefix: m[1], seq }
}

/**
 * Coerce user input into a usable prefix: uppercase, alphanumerics only,
 * truncated. Returns null when nothing usable survives, or when the result
 * doesn't start with a letter (a leading digit would make "1-2" ambiguous).
 */
export function normalisePrefix(input: string | null | undefined): string | null {
  if (!input) return null
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_PREFIX_LENGTH)
  if (!cleaned || !/^[A-Z]/.test(cleaned)) return null
  return cleaned
}

/**
 * Derive a candidate prefix from a board name, avoiding ones already taken.
 * Used by the backfill for boards whose owner never set one — a
 * wrong-but-editable prefix beats leaving that board's tasks unnumbered.
 */
export function derivePrefixFromName(
  name: string,
  taken: Set<string>,
  desiredLength = 3
): string | null {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const base = normalisePrefix(letters.slice(0, desiredLength) || letters.slice(0, 1))
  if (!base) return null
  if (!taken.has(base)) return base
  // Suffix until free. Bounded so a pathological set can't spin forever.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, MAX_PREFIX_LENGTH - String(n).length)}${n}`
    if (!taken.has(candidate)) return candidate
  }
  return null
}

/**
 * The counter value a prefix must be at least, given a manually-assigned
 * number. Someone typing OPS-500 today would otherwise guarantee a unique
 * violation months later when the counter naturally reaches 500 — a failure
 * with no obvious cause at the time it appears.
 *
 * Returns null when nothing needs doing (no ticket, different prefix, or the
 * counter is already ahead).
 */
export function counterFloorForManualTicket(
  ticket: string,
  ownedPrefix: string | null | undefined,
  currentCounter: number
): number | null {
  const parsed = parseTicket(ticket)
  if (!parsed) return null
  if (!ownedPrefix || parsed.prefix !== ownedPrefix) return null
  return parsed.seq > currentCounter ? parsed.seq : null
}
