import type { Prisma } from '@prisma/client'
import { formatTicket, parseTicket } from './ticket-number'

type Tx = Prisma.TransactionClient

/**
 * Ticket-number allocation. Impure by necessity — see `ticket-number.ts` for
 * the pure helpers.
 *
 * Every counter read is fused to its write in a single `UPDATE … RETURNING`.
 * A read-then-write in application code would let two concurrent creates see
 * the same counter and produce the same number, which the unique index turns
 * into a failed task creation. That makes atomicity a correctness requirement,
 * not a performance nicety — and it is why these are raw statements rather than
 * Prisma `update` calls.
 */

/**
 * Take the next number for a board, or null when the board owns no prefix.
 *
 * The `ticketPrefix IS NOT NULL` guard means a prefix-less board is not
 * incremented at all: no rows match, so nothing is written and the caller falls
 * through to the global sequence.
 */
async function nextForBoard(tx: Tx, boardId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ ticketPrefix: string; ticketCounter: number }>>`
    UPDATE "kanban_boards"
       SET "ticketCounter" = "ticketCounter" + 1
     WHERE "id" = ${boardId} AND "ticketPrefix" IS NOT NULL
    RETURNING "ticketPrefix", "ticketCounter"
  `
  const row = rows[0]
  return row ? formatTicket(row.ticketPrefix, row.ticketCounter) : null
}

/** Take the next number from the global sequence (tasks with no board). */
async function nextGlobal(tx: Tx): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ prefix: string; counter: number }>>`
    UPDATE "ticket_sequence"
       SET "counter" = "counter" + 1
     WHERE "id" = 'global'
    RETURNING "prefix", "counter"
  `
  const row = rows[0]
  return row ? formatTicket(row.prefix, row.counter) : null
}

/**
 * Allocate the ticket number for a new task.
 *
 * Board tasks get their board's prefix; everything else — including tasks on a
 * board whose owner never set a prefix — gets the global one. 58% of production
 * tasks have no board, so without that fallback the majority of work would have
 * no quotable id at all.
 */
export async function allocateTicketNumber(
  tx: Tx,
  boardId: string | null | undefined
): Promise<string | null> {
  if (boardId) {
    const fromBoard = await nextForBoard(tx, boardId)
    if (fromBoard) return fromBoard
  }
  return nextGlobal(tx)
}

export class TicketNumberError extends Error {}

/**
 * Validate a manually-supplied ticket number and keep the counters consistent
 * with it.
 *
 * The counter bump is the subtle part: accepting OPS-500 without raising the
 * OPS counter guarantees a unique violation months later, when normal
 * allocation finally reaches 500 — a failure whose cause is invisible by the
 * time it appears.
 *
 * Throws TicketNumberError with a message meant for the user.
 */
export async function applyManualTicketNumber(
  tx: Tx,
  raw: string,
  opts: { excludeTaskId?: string } = {}
): Promise<string> {
  const parsed = parseTicket(raw)
  if (!parsed) {
    throw new TicketNumberError(
      'Ticket number must look like OPS-14 — letters, a dash, then a number.'
    )
  }
  const value = formatTicket(parsed.prefix, parsed.seq)

  const clash = await tx.task.findFirst({
    where: { ticketNumber: value, ...(opts.excludeTaskId ? { id: { not: opts.excludeTaskId } } : {}) },
    select: { id: true, title: true },
  })
  if (clash) {
    throw new TicketNumberError(`${value} is already used by "${clash.title}".`)
  }

  // Keep whichever counter owns this prefix ahead of the number just claimed.
  // Both statements are conditional on being behind, so they are safe to run
  // concurrently and never move a counter backwards.
  await tx.$executeRaw`
    UPDATE "kanban_boards"
       SET "ticketCounter" = ${parsed.seq}
     WHERE "ticketPrefix" = ${parsed.prefix} AND "ticketCounter" < ${parsed.seq}
  `
  await tx.$executeRaw`
    UPDATE "ticket_sequence"
       SET "counter" = ${parsed.seq}
     WHERE "id" = 'global' AND "prefix" = ${parsed.prefix} AND "counter" < ${parsed.seq}
  `

  return value
}
