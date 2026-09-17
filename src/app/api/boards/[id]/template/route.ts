import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext } from '@/lib/board-roles-server'
import { templateSchema, templatePayload, roleBelongsToBoard, templateError } from '@/lib/board-templates'

export const dynamic = 'force-dynamic'

/**
 * A board's task templates. A board can hold several named ones ("PO
 * Template", "PR Template"…); the person creating a task picks one, or None.
 */

/** GET — anyone who can reach the board, since the create form lists them. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const templates = await prisma.boardTaskTemplate.findMany({
    where: { boardId: params.id },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json({ templates, canManage: ctx.permissions.canManageBoard })
}

/** POST — add a template. Requires canManageBoard. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.permissions.canManageBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const data = templateSchema.parse(await req.json())
    if (!(await roleBelongsToBoard(data.defaultRoleId, params.id))) {
      return NextResponse.json({ error: 'That role does not belong to this board.' }, { status: 400 })
    }
    const count = await prisma.boardTaskTemplate.count({ where: { boardId: params.id } })
    const template = await prisma.boardTaskTemplate.create({
      data: { boardId: params.id, position: count, ...templatePayload(data) },
    })
    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    return templateError(error, 'create')
  }
}
