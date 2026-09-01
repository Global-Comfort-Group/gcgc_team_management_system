/**
 * Backfill ticket numbers onto tasks created before the feature existed.
 *
 * Without this, ticket numbers appear on new tasks only — near-zero coverage on
 * day one, which by the same argument that motivated the feature will read as
 * broken.
 *
 * Safe to re-run: every task that already has a number is skipped, so an
 * interrupted run resumes where it stopped. Nothing is ever renumbered.
 *
 *   npx tsx scripts/backfill-ticket-numbers.ts --dry-run   # report only
 *   npx tsx scripts/backfill-ticket-numbers.ts             # apply
 */
import { PrismaClient } from '@prisma/client'
import { formatTicket, derivePrefixFromName, normalisePrefix } from '../src/lib/ticket-number'

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(DRY_RUN ? '— DRY RUN, nothing will be written —\n' : '— APPLYING —\n')

  // Subtasks deliberately get no number: they inherit their parent's context,
  // and per-step ids would multiply identifiers without adding meaning.
  // Recurring templates are hidden from boards, so they get none either.
  const scope = { parentId: null, isRecurring: false, ticketNumber: null }

  const total = await prisma.task.count({ where: scope })
  const already = await prisma.task.count({
    where: { parentId: null, isRecurring: false, NOT: { ticketNumber: null } },
  })
  console.log(`tasks needing a number: ${total}   already numbered: ${already}\n`)

  // ── 1. Make sure every board with tasks to number owns a prefix ───────────
  // A derived prefix MUST be written back to the board. Without that, runtime
  // allocation for these boards falls through to the global sequence and the
  // next task lands as TMS-1 beside siblings numbered OPS-n.
  const taken = new Set<string>(
    (await prisma.kanbanBoard.findMany({
      where: { NOT: { ticketPrefix: null } },
      select: { ticketPrefix: true },
    })).map(b => b.ticketPrefix!)
  )

  const boardsNeedingPrefix = await prisma.kanbanBoard.findMany({
    where: { ticketPrefix: null, tasks: { some: scope } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  // Remember what we derived: in a dry run nothing is written, so the board
  // pass below would otherwise skip these boards and under-report the total.
  const derived = new Map<string, string>()

  for (const b of boardsNeedingPrefix) {
    const prefix = derivePrefixFromName(b.name, taken) ?? normalisePrefix(`B${b.id.slice(0, 4)}`)
    if (!prefix) {
      console.log(`  ! could not derive a prefix for board "${b.name}" — its tasks will use the global sequence`)
      continue
    }
    taken.add(prefix)
    derived.set(b.id, prefix)
    console.log(`  board "${b.name}" -> prefix ${prefix}`)
    if (!DRY_RUN) {
      await prisma.kanbanBoard.update({ where: { id: b.id }, data: { ticketPrefix: prefix } })
    }
  }

  // ── 2. Number the board tasks, oldest first ──────────────────────────────
  const boards = await prisma.kanbanBoard.findMany({
    where: { tasks: { some: scope } },
    select: { id: true, name: true, ticketPrefix: true, ticketCounter: true },
  })

  let numbered = 0
  for (const board of boards) {
    const prefix = board.ticketPrefix ?? derived.get(board.id) ?? null
    if (!prefix) continue // no prefix at all — its tasks fall to the global pass
    const tasks = await prisma.task.findMany({
      where: { ...scope, boardId: board.id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    let seq = board.ticketCounter
    for (const t of tasks) {
      seq += 1
      const value = formatTicket(prefix, seq)
      if (!DRY_RUN) await prisma.task.update({ where: { id: t.id }, data: { ticketNumber: value } })
      numbered++
    }
    if (tasks.length) {
      console.log(`  ${prefix}: ${tasks.length} tasks -> ${prefix}-${board.ticketCounter + 1}..${seq}`)
      // Move the counter past everything just issued, so the next real task
      // continues the series instead of colliding with it.
      if (!DRY_RUN) {
        await prisma.kanbanBoard.update({ where: { id: board.id }, data: { ticketCounter: seq } })
      }
    }
  }

  // ── 3. Everything board-less, oldest first, on the global sequence ────────
  const seq0 = (await prisma.ticketSequence.findUnique({ where: { id: 'global' } }))?.counter ?? 0
  // Board-less tasks, plus any task on a board that ended up with no prefix at
  // all — otherwise those would silently stay unnumbered.
  const prefixlessBoardIds = boards.filter(b => !(b.ticketPrefix ?? derived.get(b.id))).map(b => b.id)
  const orphans = await prisma.task.findMany({
    where: { ...scope, OR: [{ boardId: null }, { boardId: { in: prefixlessBoardIds } }] },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  let g = seq0
  for (const t of orphans) {
    g += 1
    if (!DRY_RUN) {
      await prisma.task.update({ where: { id: t.id }, data: { ticketNumber: formatTicket('TMS', g) } })
    }
    numbered++
  }
  if (orphans.length) {
    console.log(`  TMS: ${orphans.length} board-less/prefix-less tasks -> TMS-${seq0 + 1}..${g}`)
    if (!DRY_RUN) {
      await prisma.ticketSequence.update({ where: { id: 'global' }, data: { counter: g } })
    }
  }

  console.log(`\n${DRY_RUN ? 'would number' : 'numbered'}: ${numbered} tasks`)

  if (!DRY_RUN) {
    const remaining = await prisma.task.count({ where: scope })
    const dupes = await prisma.$queryRaw<Array<{ ticketNumber: string; n: bigint }>>`
      SELECT "ticketNumber", count(*) AS n FROM tasks
      WHERE "ticketNumber" IS NOT NULL GROUP BY 1 HAVING count(*) > 1
    `
    console.log(`unnumbered remaining: ${remaining}   duplicates: ${dupes.length}`)
    if (remaining > 0 || dupes.length > 0) process.exitCode = 1
  }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
