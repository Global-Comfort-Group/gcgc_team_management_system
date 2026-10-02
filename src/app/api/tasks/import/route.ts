import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { parseTaskRows } from '@/lib/task-import'
import { canImportToBoard, loadImportContext, readSheet, MAX_IMPORT_BYTES } from '@/lib/task-import-server'

export const dynamic = 'force-dynamic'

// POST multipart { file, boardId } → a PREVIEW of what would be created.
// Nothing is written here: the client sends each valid row to POST /api/tasks,
// so imported tasks get exactly the checks, ticket numbers and notifications
// of tasks created by hand. See src/lib/task-import.ts for the columns.
export async function POST(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const boardId = String(form?.get('boardId') ?? '')
  if (!boardId) return NextResponse.json({ error: 'Choose a board to import into.' }, { status: 400 })
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Attach an .xlsx or .csv file.' }, { status: 400 })
  if (!/\.(xlsx|csv)$/i.test(file.name)) return NextResponse.json({ error: 'Only .xlsx and .csv files can be imported.' }, { status: 400 })
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: 'The file is larger than 2 MB.' }, { status: 400 })

  if (!(await canImportToBoard(session.user.id, session.user.role, boardId))) {
    return NextResponse.json({ error: "You don't have access to that board." }, { status: 403 })
  }

  try {
    const { header, rows } = await readSheet(Buffer.from(await file.arrayBuffer()), file.name)
    const ctx = await loadImportContext(boardId)
    const preview = parseTaskRows(header, rows, ctx)
    return NextResponse.json({ boardName: ctx.boardName, ...preview })
  } catch (e) {
    console.error('Task import parse error:', e)
    return NextResponse.json({ error: "That file couldn't be read. Save it as .xlsx or .csv and try again." }, { status: 400 })
  }
}
