import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/constants'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

// Export tasks for the current board (or All Tasks) to .xlsx, respecting the
// active board, user filter, and search. Self-contained access scope: admins
// export everything matched; everyone else only tasks they're involved in or
// that belong to a team they're on. (Phase 1 — built-in columns; custom fields
// are added once BoardField exists.)
export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!session.user.role || !hasPermission(session.user.role, PERMISSIONS.RESOURCES.TASK, 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const boardId = searchParams.get('boardId') || undefined
    const userId = searchParams.get('userId') || undefined
    const search = searchParams.get('search')?.trim() || undefined
    const dueDateFrom = searchParams.get('dueDateFrom') || undefined
    const dueDateTo = searchParams.get('dueDateTo') || undefined
    const me = session.user.id

    const and: any[] = []

    const where: any = { isRecurring: false, parentId: null }
    if (boardId) where.boardId = boardId === 'none' ? null : boardId

    // Due-date range (inclusive; 'to' extends to end-of-day), matching the board.
    if (dueDateFrom || dueDateTo) {
      const dueRange: { gte?: Date; lte?: Date } = {}
      if (dueDateFrom) {
        const f = new Date(`${dueDateFrom}T00:00:00`)
        if (!isNaN(f.getTime())) dueRange.gte = f
      }
      if (dueDateTo) {
        const t = new Date(`${dueDateTo}T23:59:59.999`)
        if (!isNaN(t.getTime())) dueRange.lte = t
      }
      if (dueRange.gte || dueRange.lte) where.dueDate = dueRange
    }

    // "Filter by user" — restrict to tasks the chosen user is involved in.
    if (userId) {
      and.push({
        OR: [
          { assigneeId: userId },
          { assignees: { some: { userId } } },
          { teamMembers: { some: { userId } } },
          { collaborators: { some: { userId } } },
        ],
      })
    }

    if (search) {
      const s = { contains: search, mode: 'insensitive' as const }
      and.push({ OR: [{ title: s }, { description: s }] })
    }

    // Access scope: non-admins only export tasks they can see.
    if (session.user.role !== 'ADMIN') {
      and.push({
        OR: [
          { creatorId: me },
          { assigneeId: me },
          { assignees: { some: { userId: me } } },
          { teamMembers: { some: { userId: me } } },
          { collaborators: { some: { userId: me } } },
          { team: { members: { some: { userId: me } } } },
        ],
      })
    }

    if (and.length) where.AND = and

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
        teamMembers: { include: { user: { select: { id: true, name: true, email: true } } } },
        collaborators: { include: { user: { select: { id: true, name: true, email: true } } } },
        fieldValues: { select: { fieldId: true, value: true } },
        board: { select: { name: true } },
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })

    const assigneesOf = (t: any): string => {
      const m = new Map<string, any>()
      if (t.assignee) m.set(t.assignee.id, t.assignee)
      t.assignees?.forEach((a: any) => { if (a.user) m.set(a.user.id, a.user) })
      t.teamMembers?.forEach((x: any) => { if (x.user) m.set(x.user.id, x.user) })
      t.collaborators?.forEach((c: any) => { if (c.user) m.set(c.user.id, c.user) })
      return Array.from(m.values()).map((u: any) => u.name || u.email).join(', ')
    }
    const ymd = (d: any): string => (d ? new Date(d).toISOString().slice(0, 10) : '')

    // Custom field columns — only meaningful when exporting a single board.
    let boardFields: { id: string; name: string; type: string }[] = []
    if (boardId && boardId !== 'none') {
      boardFields = await prisma.boardField.findMany({
        where: { boardId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, type: true },
      })
    }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Tasks')
    ws.columns = [
      // First column: the id people quote when they refer back to a row.
      { header: 'Ticket', key: 'ticket', width: 12 },
      { header: 'Title', key: 'title', width: 44 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Board', key: 'board', width: 22 },
      { header: 'Assignees', key: 'assignees', width: 32 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Start Date', key: 'start', width: 13 },
      { header: 'Due Date', key: 'due', width: 13 },
      { header: 'Progress %', key: 'progress', width: 11 },
      { header: 'Created', key: 'created', width: 13 },
      ...boardFields.map((f) => ({ header: f.name, key: `cf_${f.id}`, width: 18 })),
    ]
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }

    for (const t of tasks) {
      const valByField = new Map<string, string>(((t as any).fieldValues || []).map((v: any) => [v.fieldId, v.value]))
      const row: Record<string, any> = {
        ticket: (t as any).ticketNumber || '',
        title: t.title,
        status: STATUS_LABEL[t.status as string] || t.status,
        board: t.board?.name || t.team?.name || '',
        assignees: assigneesOf(t),
        priority: (t.priority as string).charAt(0) + (t.priority as string).slice(1).toLowerCase(),
        start: ymd(t.startDate),
        due: ymd(t.dueDate),
        progress: t.progressPercentage ?? 0,
        created: ymd(t.createdAt),
      }
      for (const f of boardFields) {
        const raw = valByField.get(f.id) || ''
        row[`cf_${f.id}`] = f.type === 'DATE' && raw ? ymd(raw) : f.type === 'NUMBER' && raw ? Number(raw) : raw
      }
      ws.addRow(row)
    }

    const buffer = await wb.xlsx.writeBuffer()
    const filename = `tasks-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Task export error:', error)
    return NextResponse.json({ error: 'Failed to export tasks' }, { status: 500 })
  }
}
