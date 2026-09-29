import {
  startOfDay, differenceInCalendarDays, eachMonthOfInterval, endOfMonth, format, max, min, addDays, subDays,
  eachWeekOfInterval, eachQuarterOfInterval, endOfQuarter, getQuarter, eachYearOfInterval, endOfYear,
} from 'date-fns'

export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** Per-zoom day-column width (px) and how far past/future to extend the axis,
 *  so the timeline always shows future periods to scroll into even with no data. */
// dayWidthPx is chosen so one period column is ~consistent width (~125px) across
// week/month/quarter/year; only the header granularity changes per zoom.
export const ZOOM: Record<TimelineZoom, { dayWidthPx: number; pastDays: number; futureDays: number }> = {
  day: { dayWidthPx: 40, pastDays: 14, futureDays: 45 },
  week: { dayWidthPx: 18, pastDays: 21, futureDays: 120 },   // ~126px/week
  month: { dayWidthPx: 4.2, pastDays: 31, futureDays: 240 }, // ~126px/month
  quarter: { dayWidthPx: 1.4, pastDays: 60, futureDays: 540 }, // ~127px/quarter
  year: { dayWidthPx: 0.34, pastDays: 120, futureDays: 1095 }, // ~124px/year
}

export interface TimelineTask {
  id: string
  title: string
  status: string
  priority?: string | null
  startDate?: string | null
  dueDate?: string | null
  assignee?: { id: string; name: string; email: string; image?: string } | null
  team?: { id: string; name: string } | null
}

export interface AssigneeGroup<T> {
  key: string
  label: string
  assignee: TimelineTask['assignee']
  tasks: T[]
}

export function groupByAssignee<T extends { assignee?: TimelineTask['assignee'] }>(
  tasks: T[]
): AssigneeGroup<T>[] {
  const named = new Map<string, AssigneeGroup<T>>()
  const unassigned: T[] = []
  for (const t of tasks) {
    const a = t.assignee
    if (!a) { unassigned.push(t); continue }
    const g = named.get(a.id) ?? { key: a.id, label: a.name || a.email, assignee: a, tasks: [] }
    g.tasks.push(t)
    named.set(a.id, g)
  }
  const groups = Array.from(named.values()).sort((x, y) =>
    x.label.toLowerCase().localeCompare(y.label.toLowerCase())
  )
  if (unassigned.length) {
    groups.push({ key: 'unassigned', label: 'Unassigned', assignee: null, tasks: unassigned })
  }
  return groups
}

// ── Arrange: group-by + sort-by ──────────────────────────────────────────────

export type GroupDimension = 'assignee' | 'status' | 'priority' | 'team' | 'none'
export type SortKey = 'dueDate' | 'startDate' | 'priority' | 'title'
export type SortDir = 'asc' | 'desc'

/** A generic timeline row group. `assignee`/`color` are optional hints the view
 *  uses to render the group header (avatar for assignee, dot for status/priority). */
export interface TimelineGroup<T> {
  key: string
  label: string
  tasks: T[]
  assignee?: TimelineTask['assignee']
  color?: string
}

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'BACKLOG', 'CANCELLED']
const STATUS_LABEL: Record<string, string> = {
  TODO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review',
  COMPLETED: 'Completed', BACKLOG: 'Archived', CANCELLED: 'Cancelled',
}
const STATUS_COLOR: Record<string, string> = {
  TODO: '#9CA3AF', IN_PROGRESS: '#3B82F6', IN_REVIEW: '#F59E0B',
  COMPLETED: '#10B981', BACKLOG: '#94A3B8', CANCELLED: '#EF4444',
}
const PRIORITY_ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
const PRIORITY_LABEL: Record<string, string> = { URGENT: 'Urgent', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }
const PRIORITY_COLOR: Record<string, string> = { URGENT: '#EF4444', HIGH: '#F97316', MEDIUM: '#EAB308', LOW: '#94A3B8' }
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

function groupByKeyed<T>(
  tasks: T[],
  keyFn: (t: T) => string,
  order: string[],
  labels: Record<string, string>,
  colors?: Record<string, string>
): TimelineGroup<T>[] {
  const m = new Map<string, T[]>()
  for (const t of tasks) {
    const k = keyFn(t)
    const arr = m.get(k) ?? []
    arr.push(t)
    m.set(k, arr)
  }
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? 999 : i }
  return Array.from(m.keys())
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(k => ({ key: k, label: labels[k] ?? k, tasks: m.get(k)!, color: colors?.[k] }))
}

function groupByTeam<T extends { team?: { id: string; name: string } | null }>(tasks: T[]): TimelineGroup<T>[] {
  const named = new Map<string, TimelineGroup<T>>()
  const noTeam: T[] = []
  for (const t of tasks) {
    const tm = t.team
    if (!tm) { noTeam.push(t); continue }
    const g = named.get(tm.id) ?? { key: tm.id, label: tm.name, tasks: [] }
    g.tasks.push(t)
    named.set(tm.id, g)
  }
  const groups = Array.from(named.values()).sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()))
  if (noTeam.length) groups.push({ key: 'no-team', label: 'No team', tasks: noTeam })
  return groups
}

/** Group timeline tasks by the chosen dimension, in a sensible order. */
export function groupTimeline<T extends {
  status: string; priority?: string | null; assignee?: TimelineTask['assignee']; team?: { id: string; name: string } | null
}>(tasks: T[], dim: GroupDimension): TimelineGroup<T>[] {
  switch (dim) {
    case 'none': return tasks.length ? [{ key: 'all', label: 'All tasks', tasks }] : []
    case 'status': return groupByKeyed(tasks, t => t.status || 'TODO', STATUS_ORDER, STATUS_LABEL, STATUS_COLOR)
    case 'priority': return groupByKeyed(tasks, t => t.priority || 'MEDIUM', PRIORITY_ORDER, PRIORITY_LABEL, PRIORITY_COLOR)
    case 'team': return groupByTeam(tasks)
    case 'assignee':
    default: return groupByAssignee(tasks)
  }
}

/** Sort tasks within a group (or the whole list when ungrouped). */
export function sortTimelineTasks<T extends {
  title: string; startDate?: string | null; dueDate?: string | null; priority?: string | null
}>(tasks: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  const val = (t: T): number | string => {
    if (key === 'dueDate') return t.dueDate ? new Date(t.dueDate).getTime() : Number.POSITIVE_INFINITY
    if (key === 'startDate') return t.startDate ? new Date(t.startDate).getTime() : Number.POSITIVE_INFINITY
    if (key === 'priority') return PRIORITY_RANK[t.priority || 'MEDIUM'] ?? 2
    return t.title.toLowerCase()
  }
  return [...tasks].sort((a, b) => {
    const va = val(a), vb = val(b)
    if (va < vb) return -1 * sign
    if (va > vb) return 1 * sign
    return 0
  })
}

export function splitScheduled<T extends Pick<TimelineTask, 'startDate' | 'dueDate'>>(
  tasks: T[]
): { scheduled: T[]; unscheduled: T[] } {
  const scheduled: T[] = []
  const unscheduled: T[] = []
  for (const t of tasks) {
    if (t.startDate && t.dueDate) scheduled.push(t)
    else unscheduled.push(t)
  }
  return { scheduled, unscheduled }
}

export interface Axis {
  start: Date
  end: Date
  zoom: TimelineZoom
  dayWidthPx: number
  totalWidthPx: number
  months: { label: string; leftPx: number; widthPx: number }[]
  days: { date: Date; leftPx: number; dayNum: number; isWeekend: boolean }[]
  /** Header columns for the current zoom (days, week ranges, months, quarters, years). */
  segments: { label: string; leftPx: number; widthPx: number }[]
}

export function buildAxis(start: Date, end: Date, zoom: TimelineZoom, dayWidthOverride?: number): Axis {
  const s = startOfDay(start)
  const e = startOfDay(end)
  const dayWidthPx = dayWidthOverride ?? ZOOM[zoom].dayWidthPx
  const totalDays = differenceInCalendarDays(e, s) + 1
  const totalWidthPx = totalDays * dayWidthPx
  const months = eachMonthOfInterval({ start: s, end: e }).map((m) => {
    const mStart = max([m, s])
    const mEnd = min([endOfMonth(m), e])
    const leftPx = differenceInCalendarDays(mStart, s) * dayWidthPx
    const widthPx = (differenceInCalendarDays(mEnd, mStart) + 1) * dayWidthPx
    return { label: format(m, 'MMM yyyy'), leftPx, widthPx }
  })
  const days = Array.from({ length: totalDays }, (_, i) => {
    const date = addDays(s, i)
    const dow = date.getDay()
    return { date, leftPx: i * dayWidthPx, dayNum: date.getDate(), isWeekend: dow === 0 || dow === 6 }
  })
  const seg = (segStart: Date, segEnd: Date, label: string) => {
    const a = max([segStart, s])
    const b = min([segEnd, e])
    return { label, leftPx: differenceInCalendarDays(a, s) * dayWidthPx, widthPx: (differenceInCalendarDays(b, a) + 1) * dayWidthPx }
  }
  let segments: { label: string; leftPx: number; widthPx: number }[]
  if (zoom === 'week') {
    segments = eachWeekOfInterval({ start: s, end: e }, { weekStartsOn: 1 }).map((w) => {
      const wStart = max([w, s])
      const wEnd = min([addDays(w, 6), e])
      const label = `${format(wStart, 'MMM d')} – ${format(wEnd, wStart.getMonth() === wEnd.getMonth() ? 'd' : 'MMM d')}`
      return seg(w, addDays(w, 6), label)
    })
  } else if (zoom === 'quarter') {
    segments = eachQuarterOfInterval({ start: s, end: e }).map((q) => seg(q, endOfQuarter(q), `Q${getQuarter(q)} ${format(q, 'yyyy')}`))
  } else if (zoom === 'year') {
    segments = eachYearOfInterval({ start: s, end: e }).map((y) => seg(y, endOfYear(y), format(y, 'yyyy')))
  } else if (zoom === 'month') {
    segments = months
  } else {
    segments = days.map((d) => ({ label: String(d.dayNum), leftPx: d.leftPx, widthPx: dayWidthPx }))
  }
  return { start: s, end: e, zoom, dayWidthPx, totalWidthPx, months, days, segments }
}

export function barGeometry(startDate: string, dueDate: string, axis: Axis): { leftPx: number; widthPx: number } {
  const s = startOfDay(new Date(startDate))
  const d = startOfDay(new Date(dueDate))
  const leftPx = differenceInCalendarDays(s, axis.start) * axis.dayWidthPx
  const days = Math.max(1, differenceInCalendarDays(d, s) + 1)
  return { leftPx, widthPx: days * axis.dayWidthPx }
}

export function axisRangeFor(
  tasks: Pick<TimelineTask, 'startDate' | 'dueDate'>[],
  today: Date,
  opts: { pastDays?: number; futureDays?: number } = {}
): { start: Date; end: Date } {
  const pastDays = opts.pastDays ?? 7
  const futureDays = opts.futureDays ?? 30
  const dates: Date[] = []
  for (const t of tasks) {
    if (t.startDate) dates.push(new Date(t.startDate))
    if (t.dueDate) dates.push(new Date(t.dueDate))
  }
  const anchors = [today, ...dates]
  const minAnchor = min(anchors)
  const maxAnchor = max(anchors)
  return {
    start: subDays(startOfDay(minAnchor), pastDays),
    end: addDays(startOfDay(maxAnchor), futureDays),
  }
}

// --- Phase 2: drag-to-reschedule pixel <-> date math ---

/** Whole-day delta from a horizontal pixel delta (round half away from zero). */
export function pxDeltaToDays(deltaPx: number, axis: Axis): number {
  return Math.sign(deltaPx) * Math.round(Math.abs(deltaPx) / axis.dayWidthPx)
}

/** Shift both dates by deltaDays, preserving duration. Returns full ISO strings. */
export function shiftDates(
  startISO: string,
  dueISO: string,
  deltaDays: number
): { startDate: string; dueDate: string } {
  return {
    startDate: addDays(new Date(startISO), deltaDays).toISOString(),
    dueDate: addDays(new Date(dueISO), deltaDays).toISOString(),
  }
}

/** Move the start date by deltaDays, clamped so it never passes the due date. */
export function resizeStart(
  startISO: string,
  dueISO: string,
  deltaDays: number
): { startDate: string; dueDate: string } {
  const due = new Date(dueISO)
  let start = addDays(new Date(startISO), deltaDays)
  if (start > due) start = due
  return { startDate: start.toISOString(), dueDate: due.toISOString() }
}

/** Move the due date by deltaDays, clamped so it never precedes the start date. */
export function resizeEnd(
  startISO: string,
  dueISO: string,
  deltaDays: number
): { startDate: string; dueDate: string } {
  const start = new Date(startISO)
  let due = addDays(new Date(dueISO), deltaDays)
  if (due < start) due = start
  return { startDate: start.toISOString(), dueDate: due.toISOString() }
}

/** Schedule a previously date-less task dropped at pixel `px` on the grid:
 *  start = the day under the drop (clamped to the first day), due = start + 1 day.
 *  Emits UTC-midnight ISO for the dropped *calendar* day (axis.start is a local
 *  Date, so we take its calendar components to avoid a TZ day-shift on serialize). */
export function scheduleAtPx(px: number, axis: Axis): { startDate: string; dueDate: string } {
  const dayOffset = Math.max(0, Math.round(px / axis.dayWidthPx))
  const d = addDays(axis.start, dayOffset)
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const due = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 1))
  return { startDate: start.toISOString(), dueDate: due.toISOString() }
}
