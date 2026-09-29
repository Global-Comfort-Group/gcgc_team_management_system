/**
 * The board search box: one matcher for every task view, so a result the
 * server returns is never hidden again by a stricter local filter (which is how
 * searching a ticket number used to come up empty — field reports 2026-09).
 *
 * A ticket number is found however it's typed: "OPS-14", "ops-14", "OPS14",
 * "#14" or "14". A bare number matches the sequence exactly, so "14" finds
 * OPS-14 but not OPS-140.
 */

type Person = { name?: string | null; email?: string | null } | null | undefined

export interface SearchableTask {
  title: string
  description?: string | null
  ticketNumber?: string | null
  assignee?: Person
  assignees?: Array<{ user?: Person }> | null
}

/** Strip a leading "#" and surrounding space. */
export function cleanTicketQuery(query: string): string {
  return query.trim().replace(/^#\s*/, '').trim()
}

/** The bare sequence number a query asks for ("#14" / "14"), or null. */
export function ticketSeqQuery(query: string): number | null {
  const q = cleanTicketQuery(query)
  if (!/^\d+$/.test(q)) return null
  const n = Number(q)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export function ticketMatches(ticketNumber: string | null | undefined, query: string): boolean {
  if (!ticketNumber) return false
  const q = cleanTicketQuery(query).toUpperCase()
  if (!q) return false
  const ticket = ticketNumber.toUpperCase()
  const seq = ticketSeqQuery(q)
  if (seq !== null) return ticket.endsWith(`-${seq}`)
  if (ticket.includes(q)) return true
  // "OPS14" / "OPS 14" for OPS-14
  const compact = (s: string) => s.replace(/[^A-Z0-9]/g, '')
  return compact(q).length > 0 && compact(ticket).includes(compact(q))
}

const has = (value: string | null | undefined, q: string) => !!value && value.toLowerCase().includes(q)
const personMatches = (p: Person, q: string) => !!p && (has(p.name, q) || has(p.email, q))

export function taskMatchesSearch(task: SearchableTask, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  return (
    ticketMatches(task.ticketNumber, query) ||
    has(task.title, q) ||
    has(task.description, q) ||
    personMatches(task.assignee, q) ||
    (task.assignees?.some((a) => personMatches(a.user, q)) ?? false)
  )
}

/**
 * The same ticket rule as a Prisma filter, for GET /api/tasks?search=. OR these
 * into the other search conditions.
 */
export function ticketSearchConditions(search: string): Array<Record<string, unknown>> {
  const q = cleanTicketQuery(search)
  if (!q) return []
  const seq = ticketSeqQuery(q)
  if (seq !== null) return [{ ticketNumber: { endsWith: `-${seq}` } }]
  const conditions: Array<Record<string, unknown>> = [
    { ticketNumber: { contains: q, mode: 'insensitive' } },
  ]
  // "OPS14" → "OPS-14"
  const m = /^([A-Za-z][A-Za-z0-9]*?)\s*-?\s*(\d+)$/.exec(q)
  if (m) conditions.push({ ticketNumber: { equals: `${m[1].toUpperCase()}-${Number(m[2])}` } })
  return conditions
}
