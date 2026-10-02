import ExcelJS from 'exceljs'
import { Readable } from 'stream'
import { prisma } from '@/lib/prisma'
import { userCanAccessBoard } from '@/lib/board-access'
import type { Cell, ImportContext } from '@/lib/task-import'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** May this user import into this board? Same rule as seeing the board. */
export async function canImportToBoard(userId: string, role: string | undefined, boardId: string): Promise<boolean> {
  if (role === 'ADMIN') return !!(await prisma.kanbanBoard.findUnique({ where: { id: boardId }, select: { id: true } }))
  return userCanAccessBoard(prisma, userId, boardId)
}

/** The board's statuses, fields and people (owner, explicit members, team). */
export async function loadImportContext(boardId: string): Promise<ImportContext & { boardName: string }> {
  const board = await prisma.kanbanBoard.findUniqueOrThrow({
    where: { id: boardId },
    select: {
      name: true,
      owner: { select: { id: true, name: true, email: true, isActive: true } },
      members: { select: { user: { select: { id: true, name: true, email: true, isActive: true } } } },
      team: { select: { members: { select: { user: { select: { id: true, name: true, email: true, isActive: true } } } } } },
      statuses: { select: { id: true, name: true, category: true, isDefault: true }, orderBy: { position: 'asc' } },
      fields: { select: { id: true, name: true, type: true, options: true, required: true }, orderBy: { position: 'asc' } },
    },
  })
  const people = new Map<string, { id: string; name: string | null; email: string }>()
  for (const u of [board.owner, ...board.members.map((m) => m.user), ...(board.team?.members.map((m) => m.user) ?? [])]) {
    if (u && u.isActive) people.set(u.id, { id: u.id, name: u.name, email: u.email })
  }
  return {
    boardName: board.name,
    statuses: board.statuses.map((s) => ({ ...s, category: s.category as string })),
    fields: board.fields,
    people: Array.from(people.values()),
  }
}

/** exceljs cell values → plain values the parser understands. */
function plain(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return plain(v.result as ExcelJS.CellValue)
    if ('text' in v) return String((v as { text: unknown }).text)
    if ('error' in v) return null
  }
  return String(v)
}

/** Read the first worksheet of an .xlsx or .csv into a header + rows matrix. */
export async function readSheet(buffer: Buffer, filename: string): Promise<{ header: Cell[]; rows: Cell[][] }> {
  const wb = new ExcelJS.Workbook()
  if (/\.csv$/i.test(filename)) {
    // Excel saves CSV with a BOM; exceljs would make it part of the first header.
    const text = buffer.toString('utf8').replace(/^﻿/, '')
    await wb.csv.read(Readable.from([text]))
  } else {
    await wb.xlsx.load(buffer as any)
  }
  const ws = wb.getWorksheet('Tasks') ?? wb.worksheets[0]
  if (!ws) return { header: [], rows: [] }
  const matrix: Cell[][] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: Cell[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = plain(cell.value) })
    matrix[n - 1] = cells
  })
  const [header = [], ...rows] = Array.from(matrix, (r) => r ?? [])
  return { header, rows }
}
