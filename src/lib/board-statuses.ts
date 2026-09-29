import { Prisma, PrismaClient, TaskStatus } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

// The four defaults seeded on every board (isDefault), mapping 1:1 to the
// TaskStatus categories so an un-customized board behaves exactly as before.
// BACKLOG is intentionally NOT a board column — it's a hidden archive state.
export const DEFAULT_BOARD_STATUSES: { name: string; category: TaskStatus; color: string; position: number }[] = [
  { name: 'To Do', category: 'TODO', color: '#94A3B8', position: 0 },
  { name: 'In Progress', category: 'IN_PROGRESS', color: '#3B82F6', position: 1 },
  { name: 'In Review', category: 'IN_REVIEW', color: '#F59E0B', position: 2 },
  { name: 'Completed', category: 'COMPLETED', color: '#22C55E', position: 3 },
]

// Seed the default statuses for a board. Idempotent via @@unique([boardId, name]).
export async function seedDefaultBoardStatuses(db: Db, boardId: string): Promise<void> {
  await db.boardStatus.createMany({
    data: DEFAULT_BOARD_STATUSES.map((d) => ({ ...d, boardId, isDefault: true })),
    skipDuplicates: true,
  })
}

type StatusRow = { id: string; name: string; category: TaskStatus; isDefault: boolean; position: number }

export interface DefaultStatusRepair {
  /** Default statuses to create (their category has no status at all). */
  create: typeof DEFAULT_BOARD_STATUSES
  /** Existing statuses to mark isDefault (their category had no default). */
  promote: string[]
}

/**
 * Every board needs one default status per column category: tasks with no
 * customStatusId are bucketed into it, and moves/intake forms land there.
 *
 * Boards made before custom statuses existed have NO status rows and render the
 * built-in columns. Adding a first custom status used to make those built-in
 * columns vanish (field reports 2026-09: "adding a status deletes every
 * status"). This works out what to add so every category is covered again:
 * a category with statuses but no default promotes its first status; a
 * category with none gets the stock default. Pure, so it can be unit-tested.
 */
export function planDefaultStatusRepair(statuses: StatusRow[]): DefaultStatusRepair {
  const create: DefaultStatusRepair['create'] = []
  const promote: string[] = []
  const takenNames = new Set(statuses.map((s) => s.name.toLowerCase()))
  for (const def of DEFAULT_BOARD_STATUSES) {
    const inCategory = statuses
      .filter((s) => s.category === def.category)
      .sort((a, b) => a.position - b.position)
    if (inCategory.some((s) => s.isDefault)) continue
    if (inCategory.length > 0) promote.push(inCategory[0].id)
    else if (!takenNames.has(def.name.toLowerCase())) create.push(def)
  }
  return { create, promote }
}

export function needsDefaultStatusRepair(statuses: StatusRow[]): boolean {
  const r = planDefaultStatusRepair(statuses)
  return r.create.length > 0 || r.promote.length > 0
}

const CATEGORY_RANK = new Map<string, number>(DEFAULT_BOARD_STATUSES.map((d) => [d.category, d.position]))

/**
 * Apply `planDefaultStatusRepair` to a board. When statuses are created, the
 * board is re-ordered by column category (keeping the existing order within a
 * category) so a restored "To Do" doesn't land after "Completed".
 * Returns true when anything changed.
 */
export async function ensureDefaultBoardStatuses(db: Db, boardId: string): Promise<boolean> {
  const statuses = await db.boardStatus.findMany({
    where: { boardId },
    select: { id: true, name: true, category: true, isDefault: true, position: true },
  })
  const plan = planDefaultStatusRepair(statuses)
  if (plan.create.length === 0 && plan.promote.length === 0) return false

  if (plan.promote.length > 0) {
    await db.boardStatus.updateMany({ where: { id: { in: plan.promote } }, data: { isDefault: true } })
  }
  if (plan.create.length > 0) {
    await db.boardStatus.createMany({
      data: plan.create.map((d) => ({ ...d, boardId, isDefault: true })),
      skipDuplicates: true,
    })
    if (statuses.length > 0) {
      const all = await db.boardStatus.findMany({
        where: { boardId },
        select: { id: true, category: true, isDefault: true, position: true },
      })
      const rank = (c: string) => CATEGORY_RANK.get(c) ?? 99
      all.sort((a, b) =>
        rank(a.category) - rank(b.category) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.position - b.position)
      for (let i = 0; i < all.length; i++) {
        if (all[i].position !== i) {
          await db.boardStatus.update({ where: { id: all[i].id }, data: { position: i } })
        }
      }
    }
  }
  return true
}

/** Which status takes over as a category's default when its default is deleted. */
export function pickReplacementDefault<T extends { id: string; category: TaskStatus; position: number }>(
  statuses: T[],
  deleting: T,
): T | null {
  return (
    statuses
      .filter((s) => s.id !== deleting.id && s.category === deleting.category)
      .sort((a, b) => a.position - b.position)[0] ?? null
  )
}

export const CATEGORY_LABEL: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  COMPLETED: 'Completed',
}

// Who may edit a board's statuses/fields: admins, the board owner (personal
// boards), or a team LEADER of the board's team (team boards).
export async function canManageBoard(
  db: Db,
  userId: string,
  role: string | undefined,
  boardId: string
): Promise<boolean> {
  if (role === 'ADMIN') return true
  const board = await db.kanbanBoard.findUnique({
    where: { id: boardId },
    select: { ownerId: true, teamId: true },
  })
  if (!board) return false
  if (board.ownerId === userId) return true
  if (board.teamId) {
    const m = await db.teamMember.findUnique({
      where: { userId_teamId: { userId, teamId: board.teamId } },
      select: { role: true },
    })
    return m?.role === 'LEADER'
  }
  return false
}
