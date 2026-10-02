import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getRequestSession } from '@/lib/api-auth'
import { canImportToBoard, loadImportContext } from '@/lib/task-import-server'

export const dynamic = 'force-dynamic'

// GET ?boardId= → an .xlsx with the import columns for that board (its custom
// fields included), one example row, and drop-downs for Status / Priority.
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const boardId = new URL(req.url).searchParams.get('boardId') || ''
  if (!boardId || !(await canImportToBoard(session.user.id, session.user.role, boardId))) {
    return NextResponse.json({ error: "You don't have access to that board." }, { status: 403 })
  }

  const ctx = await loadImportContext(boardId)
  const statusNames = ctx.statuses.filter((s) => s.category !== 'BACKLOG' && s.category !== 'CANCELLED').map((s) => s.name)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tasks')
  ws.columns = [
    { header: 'Title', key: 'title', width: 44 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Assignees', key: 'assignees', width: 32 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Start Date', key: 'start', width: 13 },
    { header: 'Due Date', key: 'due', width: 13 },
    { header: 'Progress %', key: 'progress', width: 11 },
    { header: 'Description', key: 'description', width: 40 },
    ...ctx.fields.map((f) => ({ header: f.name, key: `cf_${f.id}`, width: 18 })),
  ]
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF1F5' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const example = ctx.people[0]
  ws.addRow({
    title: 'Example — replace or delete this row',
    status: statusNames[0] ?? 'To Do',
    assignees: example ? example.email : '',
    priority: 'Medium',
    start: '',
    due: new Date().toISOString().slice(0, 10),
    progress: 0,
    description: 'Separate several assignees with commas. Use emails if two people share a name.',
  })
  const list = (values: string[]) => ({ type: 'list' as const, allowBlank: true, formulae: [`"${values.join(',').replace(/"/g, '')}"`] })
  for (let r = 2; r <= 501; r++) {
    if (statusNames.length) ws.getCell(`B${r}`).dataValidation = list(statusNames)
    ws.getCell(`D${r}`).dataValidation = list(['Low', 'Medium', 'High', 'Urgent'])
  }
  const buffer = await wb.xlsx.writeBuffer()
  const safe = ctx.boardName.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'board'
  return new NextResponse(buffer as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="import-template-${safe}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
