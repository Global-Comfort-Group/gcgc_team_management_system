import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageBoard, pickReplacementDefault, CATEGORY_LABEL } from '@/lib/board-statuses'
import { z } from 'zod'

const updateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  category: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
})

// PATCH — rename / recolor / reorder / re-categorize a status.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; statusId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const existing = await prisma.boardStatus.findFirst({
    where: { id: params.statusId, boardId: params.id },
  })
  if (!existing) return NextResponse.json({ error: 'Status not found' }, { status: 404 })

  try {
    const data = updateSchema.parse(await req.json())

    // Default statuses must keep their category (they anchor the fallback bucketing).
    if (data.category && data.category !== existing.category && existing.isDefault) {
      return NextResponse.json({ error: "A default status's category can't be changed." }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.boardStatus.update({
        where: { id: params.statusId },
        data: {
          ...(data.name !== undefined ? { name: data.name.trim() } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
        },
      })
      // Re-categorizing a custom status: re-sync the category on its tasks so
      // completion gating / progress / overdue stay correct.
      if (data.category && data.category !== existing.category) {
        await tx.task.updateMany({
          where: { customStatusId: params.statusId },
          data: { status: data.category },
        })
      }
      return updated
    })

    return NextResponse.json({ status: result })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'A status with that name already exists on this board.' }, { status: 409 })
    }
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid status data.' }, { status: 400 })
    }
    console.error('Update board status error:', error)
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
  }
}

// DELETE — remove a status. Tasks on a deleted custom status have customStatusId
// set null (FK) and fall back to their category's default column.
//
// A default can be deleted too, as long as another status of its category is
// left: that one becomes the default and takes over the deleted status's tasks.
// The last status of a category can't go — tasks need a column to land in.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; statusId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const existing = await prisma.boardStatus.findFirst({
    where: { id: params.statusId, boardId: params.id },
  })
  if (!existing) return NextResponse.json({ error: 'Status not found' }, { status: 404 })

  const siblings = await prisma.boardStatus.findMany({ where: { boardId: params.id } })
  const replacement = pickReplacementDefault(siblings, existing)
  if (!replacement) {
    const label = CATEGORY_LABEL[existing.category] ?? existing.category
    return NextResponse.json({
      error: `"${existing.name}" is the only ${label} status. Rename it instead, or add another ${label} status first.`,
    }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    if (existing.isDefault) {
      await tx.boardStatus.update({ where: { id: replacement.id }, data: { isDefault: true } })
      await tx.task.updateMany({
        where: { customStatusId: existing.id },
        data: { customStatusId: replacement.id },
      })
    }
    await tx.boardStatus.delete({ where: { id: params.statusId } })
  })
  return NextResponse.json({ ok: true })
}
