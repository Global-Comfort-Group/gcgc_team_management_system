import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext } from '@/lib/board-roles-server'

export const dynamic = 'force-dynamic'

const templateSchema = z.object({
  titlePrefix: z.string().trim().max(60).nullish(),
  description: z.string().max(2000).nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullish(),
  taskWeight: z.number().int().min(1).max(5).nullish(),
  slaHours: z.number().int().min(1).nullish(),
  defaultRoleId: z.string().nullish(),
  // Seeded as subtasks on a new task. Titles only — anything richer belongs in
  // the task itself, not in a default.
  checklist: z.array(z.object({ title: z.string().trim().min(1).max(200) })).max(50).nullish(),
})

/** GET — anyone who can reach the board, since the form needs the defaults. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const template = await prisma.boardTaskTemplate.findUnique({ where: { boardId: params.id } })
  return NextResponse.json({ template, canManage: ctx.permissions.canManageBoard })
}

/** PUT — upsert the board's single template. Requires canManageBoard. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.permissions.canManageBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = templateSchema.parse(await req.json())

    // A default role pointing at another board's role would silently produce
    // tasks addressed to a role nobody on this board holds.
    if (data.defaultRoleId) {
      const role = await prisma.boardRole.findFirst({
        where: { id: data.defaultRoleId, boardId: params.id },
        select: { id: true },
      })
      if (!role) {
        return NextResponse.json({ error: 'That role does not belong to this board.' }, { status: 400 })
      }
    }

    const payload = {
      titlePrefix: data.titlePrefix ?? null,
      description: data.description ?? null,
      priority: data.priority ?? null,
      taskWeight: data.taskWeight ?? null,
      slaHours: data.slaHours ?? null,
      defaultRoleId: data.defaultRoleId ?? null,
      checklist: data.checklist ?? undefined,
    }

    const template = await prisma.boardTaskTemplate.upsert({
      where: { boardId: params.id },
      create: { boardId: params.id, ...payload },
      update: payload,
    })
    return NextResponse.json({ template })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Board template save error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE — clear the template so new tasks start blank again. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.permissions.canManageBoard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.boardTaskTemplate.deleteMany({ where: { boardId: params.id } })
  return NextResponse.json({ ok: true })
}
