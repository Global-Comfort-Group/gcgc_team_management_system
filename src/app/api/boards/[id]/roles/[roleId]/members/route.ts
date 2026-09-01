import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext, guardBoardManageability } from '@/lib/board-roles-server'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ userId: z.string().min(1) })

async function authorize(boardId: string, roleId: string, userId: string, userRole: any) {
  const ctx = await loadBoardRoleContext(boardId, userId, userRole)
  if (!ctx) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!ctx.permissions.canManageBoard) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const role = await prisma.boardRole.findFirst({ where: { id: roleId, boardId }, select: { id: true } })
  if (!role) return { error: NextResponse.json({ error: 'Role not found' }, { status: 404 }) }
  return { ctx }
}

/** POST — give a user this role. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; roleId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await authorize(params.id, params.roleId, session.user.id, session.user.role)
  if (auth.error) return auth.error

  try {
    const { userId } = bodySchema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 })

    const assignment = await prisma.boardRoleAssignment.create({
      data: { roleId: params.roleId, userId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    })
    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'That person already holds this role.' }, { status: 409 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Board role assign error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** DELETE — take this role away from a user. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; roleId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await authorize(params.id, params.roleId, session.user.id, session.user.role)
  if (auth.error) return auth.error

  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  // Removing the last holder of the last managing role would freeze the board.
  const denied = await guardBoardManageability(
    params.id,
    { action: 'unassign', roleId: params.roleId, userId },
    auth.ctx!.hasStandingAdmin
  )
  if (denied) return denied

  await prisma.boardRoleAssignment.deleteMany({ where: { roleId: params.roleId, userId } })
  return NextResponse.json({ ok: true })
}
