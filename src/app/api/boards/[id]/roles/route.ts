import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext, requireManageBoard } from '@/lib/board-roles-server'

export const dynamic = 'force-dynamic'

const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  canCreateTask: z.boolean().optional(),
  canEditAnyTask: z.boolean().optional(),
  canDeleteTask: z.boolean().optional(),
  canChangeStatus: z.boolean().optional(),
  canApprove: z.boolean().optional(),
  canManageBoard: z.boolean().optional(),
})

/** GET — anyone who can reach the board may see its roles (they need to pick one). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ctx = await loadBoardRoleContext(params.id, session.user.id, session.user.role)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roles = await prisma.boardRole.findMany({
    where: { boardId: params.id },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({ roles, permissions: ctx.permissions })
}

/** POST — create a role. Requires canManageBoard. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireManageBoard(params.id, session.user.id, session.user.role)
  if (denied) return denied

  try {
    const data = createRoleSchema.parse(await req.json())
    const count = await prisma.boardRole.count({ where: { boardId: params.id } })
    const role = await prisma.boardRole.create({
      data: { ...data, boardId: params.id, position: count },
      include: { assignments: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } },
    })
    return NextResponse.json({ role }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'A role with that name already exists on this board.' }, { status: 409 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Board role create error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
