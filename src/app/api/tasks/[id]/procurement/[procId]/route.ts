import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/storage'
import { z } from 'zod'

const updateProcurementSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED']).optional(),
  notes: z.string().max(1000).optional(),
})

// PATCH /api/tasks/[id]/procurement/[procId]
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; procId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.user.role !== 'ADMIN' && session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders and admins can update procurement records' }, { status: 403 })
    }

    const body = await request.json()
    const data = updateProcurementSchema.parse(body)

    const procurement = await prisma.taskProcurement.findUnique({ where: { id: params.procId } })
    if (!procurement || procurement.taskId !== params.id) {
      return NextResponse.json({ error: 'Procurement record not found' }, { status: 404 })
    }

    const updated = await prisma.taskProcurement.update({
      where: { id: params.procId },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true, image: true } },
      },
    })

    return NextResponse.json({ procurement: updated })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error('Error updating procurement:', error)
    return NextResponse.json({ error: 'Failed to update procurement' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]/procurement/[procId]
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; procId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const procurement = await prisma.taskProcurement.findUnique({ where: { id: params.procId } })
    if (!procurement || procurement.taskId !== params.id) {
      return NextResponse.json({ error: 'Procurement record not found' }, { status: 404 })
    }

    const isAuthorized =
      procurement.createdById === session.user.id ||
      session.user.role === 'ADMIN' ||
      session.user.role === 'LEADER'

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (procurement.objectKey) {
      await deleteFile(procurement.objectKey)
    }

    await prisma.taskProcurement.delete({ where: { id: params.procId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting procurement:', error)
    return NextResponse.json({ error: 'Failed to delete procurement' }, { status: 500 })
  }
}
