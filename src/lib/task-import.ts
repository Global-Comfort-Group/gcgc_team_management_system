/**
 * Turn an uploaded spreadsheet into tasks for one board (field reports
 * 2026-10). The columns are the ones the Export writes, so an exported file can
 * be edited and imported back:
 *
 *   Ticket | Title | Status | Board | Assignees | Priority | Start Date |
 *   Due Date | Progress % | Created | <custom field columns>
 *
 * Ticket, Board and Created are read-only on import: the target board is the
 * one chosen in the dialog, and every imported row is a NEW task with its own
 * ticket number. Headers are matched case-insensitively, in any order.
 *
 * Pure: the route reads the file and loads the board's statuses, fields and
 * people; this decides, row by row, what would be created and why a row can't
 * be. Nothing is written here — the client sends each valid row to the normal
 * create-task API, so imported tasks go through exactly the same checks.
 */

export type Cell = string | number | boolean | Date | null | undefined

export interface ImportContext {
  statuses: { id: string; name: string; category: string; isDefault: boolean }[]
  fields: { id: string; name: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'; options: string[]; required: boolean }[]
  people: { id: string; name: string | null; email: string }[]
}

export interface ImportTask {
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED'
  customStatusId?: string
  /** "YYYY-MM-DD" — the client turns it into local midnight, like the form. */
  startDate?: string
  dueDate: string
  /** Filled in by the route: the dates as instants in the app timezone. */
  startDateIso?: string
  dueDateIso?: string
  progressPercentage?: number
  assigneeIds: string[]
  fieldValues: { fieldId: string; value: string }[]
}

export interface ImportRow {
  /** The row number as shown in Excel (header = 1). */
  row: number
  title: string
  errors: string[]
  warnings: string[]
  task?: ImportTask
}

export interface ImportPreview {
  recognized: string[]
  ignored: string[]
  missingRequired: string[]
  rows: ImportRow[]
}

export const MAX_IMPORT_ROWS = 500
const TITLE_MAX = 100

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const BUILT_IN: Record<string, string[]> = {
  title: ['title', 'task', 'tasktitle', 'taskname', 'summary'],
  description: ['description', 'details', 'notes'],
  status: ['status'],
  assignees: ['assignees', 'assignee', 'assignedto', 'owner'],
  priority: ['priority'],
  startDate: ['startdate', 'start'],
  dueDate: ['duedate', 'due', 'deadline'],
  progress: ['progress', 'progresspercent', 'progresspct'],
}

const CATEGORY_BY_LABEL: Record<string, ImportTask['status']> = {
  todo: 'TODO', inprogress: 'IN_PROGRESS', inreview: 'IN_REVIEW', review: 'IN_REVIEW',
  completed: 'COMPLETED', done: 'COMPLETED',
}

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return ''
  if (c instanceof Date) return isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10)
  return String(c).trim()
}

const pad = (n: number) => String(n).padStart(2, '0')
function validYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * A date cell → "YYYY-MM-DD", or null if it isn't a date. Accepts real Excel
 * dates (exceljs gives them as UTC midnight), Excel serial numbers, ISO
 * "2026-10-10" / "2026/10/10", and "10/10/2026" read month-first, as Excel
 * writes it in the Philippines.
 */
export function parseDateCell(c: Cell): string | null {
  if (c instanceof Date) return isNaN(c.getTime()) ? null : validYmd(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate())
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86400000)
    return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = cellText(c)
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s)
  if (m) return validYmd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return validYmd(+m[3], +m[1], +m[2])
  return null
}

export function parseTaskRows(header: Cell[], rows: Cell[][], ctx: ImportContext): ImportPreview {
  const fieldByNorm = new Map(ctx.fields.map((f) => [norm(f.name), f]))
  const colOf: Record<string, number> = {}
  const fieldCols: { col: number; field: ImportContext['fields'][number] }[] = []
  const recognized: string[] = []
  const ignored: string[] = []

  header.forEach((h, col) => {
    const label = cellText(h)
    if (!label) return
    const n = norm(label)
    const builtIn = Object.entries(BUILT_IN).find(([, aliases]) => aliases.includes(n))?.[0]
    if (builtIn && colOf[builtIn] === undefined) { colOf[builtIn] = col; recognized.push(label); return }
    const field = fieldByNorm.get(n)
    if (field && !fieldCols.some((x) => x.field.id === field.id)) { fieldCols.push({ col, field }); recognized.push(label); return }
    ignored.push(label) // incl. the export's Ticket / Board / Created
  })

  const missingRequired = [
    ...(colOf.title === undefined ? ['Title'] : []),
    ...(colOf.dueDate === undefined ? ['Due Date'] : []),
  ]

  // People: by email, or by name when exactly one board member has it.
  const byEmail = new Map(ctx.people.map((p) => [p.email.toLowerCase(), p]))
  const byName = new Map<string, ImportContext['people']>()
  for (const p of ctx.people) {
    if (!p.name) continue
    const k = p.name.toLowerCase().replace(/\s+/g, ' ').trim()
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const statusByName = new Map(ctx.statuses.map((s) => [norm(s.name), s]))

  const out: ImportRow[] = []
  rows.forEach((r, i) => {
    const get = (key: string) => (colOf[key] === undefined ? undefined : r[colOf[key]])
    if (r.every((c) => cellText(c) === '')) return // blank line
    const row: ImportRow = { row: i + 2, title: cellText(get('title')), errors: [], warnings: [] }
    out.push(row)

    // Title
    if (!row.title) row.errors.push('Title is empty.')
    else if (row.title.length > TITLE_MAX) row.errors.push(`Title is longer than ${TITLE_MAX} characters.`)

    // Dates
    const dueRaw = get('dueDate')
    const dueDate = parseDateCell(dueRaw ?? null)
    if (!cellText(dueRaw)) row.errors.push('Due Date is empty — every task needs a deadline.')
    else if (!dueDate) row.errors.push(`Due Date "${cellText(dueRaw)}" isn't a date (use YYYY-MM-DD).`)
    const startRaw = get('startDate')
    let startDate: string | undefined
    if (cellText(startRaw)) {
      startDate = parseDateCell(startRaw ?? null) ?? undefined
      if (!startDate) row.errors.push(`Start Date "${cellText(startRaw)}" isn't a date (use YYYY-MM-DD).`)
    }
    if (startDate && dueDate && startDate > dueDate) row.errors.push('Start Date is after the Due Date.')

    // Status: a board status by name, else a column category, else To Do.
    let status: ImportTask['status'] = 'TODO'
    let customStatusId: string | undefined
    const statusText = cellText(get('status'))
    if (statusText) {
      const byBoard = statusByName.get(norm(statusText))
      const cat = CATEGORY_BY_LABEL[norm(statusText)]
      if (byBoard && byBoard.category in { TODO: 1, IN_PROGRESS: 1, IN_REVIEW: 1, COMPLETED: 1 }) {
        status = byBoard.category as ImportTask['status']
        customStatusId = byBoard.id
      } else if (cat) {
        status = cat
      } else {
        row.warnings.push(`Unknown status "${statusText}" — it will start in To Do.`)
      }
    }

    // Priority
    let priority: ImportTask['priority'] = 'MEDIUM'
    const prText = cellText(get('priority')).toUpperCase()
    if (prText) {
      if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(prText)) priority = prText as ImportTask['priority']
      else row.warnings.push(`Unknown priority "${cellText(get('priority'))}" — set to Medium.`)
    }

    // Progress %
    let progressPercentage: number | undefined
    const pgText = cellText(get('progress')).replace('%', '').trim()
    if (pgText) {
      const n = Number(pgText)
      if (Number.isFinite(n) && n >= 0 && n <= 100) progressPercentage = Math.round(n)
      else row.warnings.push(`Progress "${cellText(get('progress'))}" isn't 0–100 — ignored.`)
    }

    // Assignees
    const assigneeIds: string[] = []
    for (const raw of cellText(get('assignees')).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)) {
      const email = byEmail.get(raw.toLowerCase())
      const named = byName.get(raw.toLowerCase().replace(/\s+/g, ' '))
      const person = email ?? (named?.length === 1 ? named[0] : undefined)
      if (person) { if (!assigneeIds.includes(person.id)) assigneeIds.push(person.id) }
      else if (named && named.length > 1) row.warnings.push(`"${raw}" matches more than one person — use their email. Skipped.`)
      else row.warnings.push(`"${raw}" isn't on this board — skipped.`)
    }

    // Custom fields
    const fieldValues: ImportTask['fieldValues'] = []
    for (const { col, field } of fieldCols) {
      const raw = r[col]
      const text = cellText(raw)
      if (!text) continue
      if (field.type === 'DATE') {
        const d = parseDateCell(raw ?? null)
        if (d) fieldValues.push({ fieldId: field.id, value: d })
        else row.warnings.push(`${field.name}: "${text}" isn't a date — ignored.`)
      } else if (field.type === 'NUMBER') {
        if (Number.isFinite(Number(text))) fieldValues.push({ fieldId: field.id, value: String(Number(text)) })
        else row.warnings.push(`${field.name}: "${text}" isn't a number — ignored.`)
      } else if (field.type === 'SELECT') {
        const opt = field.options.find((o) => o.toLowerCase() === text.toLowerCase())
        if (opt) fieldValues.push({ fieldId: field.id, value: opt })
        else row.warnings.push(`${field.name}: "${text}" isn't one of its choices — ignored.`)
      } else {
        fieldValues.push({ fieldId: field.id, value: text })
      }
    }
    for (const f of ctx.fields) {
      if (f.required && !fieldValues.some((v) => v.fieldId === f.id)) row.errors.push(`${f.name} is required on this board.`)
    }

    if (row.errors.length === 0 && dueDate) {
      const description = cellText(get('description'))
      row.task = {
        title: row.title,
        ...(description ? { description } : {}),
        priority,
        status,
        ...(customStatusId ? { customStatusId } : {}),
        ...(startDate ? { startDate } : {}),
        dueDate,
        ...(progressPercentage !== undefined ? { progressPercentage } : {}),
        assigneeIds,
        fieldValues,
      }
    }
  })

  if (out.length > MAX_IMPORT_ROWS) {
    out.slice(MAX_IMPORT_ROWS).forEach((r) => { r.errors.push(`Only the first ${MAX_IMPORT_ROWS} rows can be imported at once.`); delete r.task })
  }
  return { recognized, ignored, missingRequired, rows: out }
}
