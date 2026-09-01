import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { loadBoardRoleContext, guardBoardManageability } from '@/lib/board-roles-server'

export const dynamic = 'force-dynamic'

const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  canCreateTask: z.boolean().optional(),
  canEditAnyTask: z.boolean().optional(),
  canDeleteTask: z.boolean().optional(),
  canChangeStatus: z.boolean().optional(),
  canApprove: z.boolean().optional(),
  canManageBoard: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; roleId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await authorize(params.id, params.roleId, session.user.id, session.user.role)
  if (auth.error) return auth.error

  try {
    const data = updateRoleSchema.parse(await req.json())

    // Revoking management from the last managing role would freeze the board.
    if (data.canManageBoard === false) {
      const denied = await guardBoardManageability(
        params.id,
        { action: 'update', roleId: params.roleId, canManageBoard: false },
        auth.ctx!.hasStandingAdmin
      )
      if (denied) return denied
    }

    const role = await prisma.boardRole.update({
      where: { id: params.roleId },
      data,
      include: { assignments: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } },
    })
    return NextResponse.json({ role })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'A role with that name already exists on this board.' }, { status: 409 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Board role update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; roleId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const auth = await authorize(params.id, params.roleId, session.user.id, session.user.role)
  if (auth.error) return auth.error

  const denied = await guardBoardManageability(
    params.id,
    { action: 'delete', roleId: params.roleId },
    auth.ctx!.hasStandingAdmin
  )
  if (denied) return denied

  // Tasks addressed to this role keep working: assignedRoleId is SetNull, and
  // assigneeId — which actually owns the task — is untouched.
  await prisma.boardRole.delete({ where: { id: params.roleId } })
  return NextResponse.json({ ok: true })
}
