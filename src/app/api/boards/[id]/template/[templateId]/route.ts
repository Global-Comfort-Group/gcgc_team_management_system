import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext } from '@/lib/board-roles-server'
import { templateSchema, templatePayload, roleBelongsToBoard, templateError } from '@/lib/board-templates'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string; templateId: string } }

async function authorize(boardId: string, userId: string, role: any) {
  const ctx = await loadBoardRoleContext(boardId, userId, role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.permissions.canManageBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

/** PUT — update one template. Requires canManageBoard. */
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await authorize(params.id, session.user.id, session.user.role)
  if (denied) return denied

  try {
    const data = templateSchema.parse(await req.json())
    if (!(await roleBelongsToBoard(data.defaultRoleId, params.id))) {
      return NextResponse.json({ error: 'That role does not belong to this board.' }, { status: 400 })
    }
    // Scoped by board so a template id from another board cannot be edited here.
    const res = await prisma.boardTaskTemplate.updateMany({
      where: { id: params.templateId, boardId: params.id },
      data: templatePayload(data),
    })
    if (res.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const template = await prisma.boardTaskTemplate.findUnique({ where: { id: params.templateId } })
    return NextResponse.json({ template })
  } catch (error) {
    return templateError(error, 'update')
  }
}

/** DELETE — remove one template. Requires canManageBoard. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = await authorize(params.id, session.user.id, session.user.role)
  if (denied) return denied

  await prisma.boardTaskTemplate.deleteMany({ where: { id: params.templateId, boardId: params.id } })
  return NextResponse.json({ ok: true })
}
