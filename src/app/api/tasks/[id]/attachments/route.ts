import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { canViewTask } from '@/lib/task-access'

const addAttachmentSchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().min(1).max(255),
  fileType: z.string().optional().nullable(),
  fileSize: z.number().int().nonnegative().optional().nullable(),
})

// Anyone involved in the task may add or remove its attachments: the creator,
// the assigner, any assignee (flat list + legacy field), team members, or
// collaborators. Admins always pass. Returns null when the task is missing.
async function getInvolvement(taskId: string, userId: string, isAdmin: boolean) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      creatorId: true,
      assigneeId: true,
      assignedById: true,
      assignees: { select: { userId: true } },
      teamMembers: { select: { userId: true } },
      collaborators: { select: { userId: true } },
    },
  })
  if (!task) return { task: null, involved: false }
  const involved =
    isAdmin ||
    task.creatorId === userId ||
    task.assigneeId === userId ||
    task.assignedById === userId ||
    task.assignees.some((a) => a.userId === userId) ||
    task.teamMembers.some((m) => m.userId === userId) ||
    task.collaborators.some((c) => c.userId === userId)
  return { task, involved }
}

// GET /api/tasks/[id]/attachments
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // This list had no authorization at all: any signed-in user could read any
    // task's attachments, direct OSS URLs included. Same rule as the preview
    // proxy now — anyone who can see the task.
    const { task: viewTask, allowed } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!viewTask) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const attachments = await prisma.taskAttachment.findMany({
      where: { taskId: params.id },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ attachments })
  } catch (error) {
    console.error('Error fetching attachments:', error)
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/attachments
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isAdmin = session.user.role === 'ADMIN'
    const { task, involved } = await getInvolvement(params.id, session.user.id, isAdmin)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    if (!involved) {
      return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })
    }

    const body = await request.json()
    const data = addAttachmentSchema.parse(body)

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: params.id,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileType: data.fileType ?? null,
        fileSize: data.fileSize ?? null,
        uploadedById: session.user.id,
      },
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
    })

    return NextResponse.json({ attachment }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error('Error adding attachment:', error)
    return NextResponse.json({ error: 'Failed to add attachment' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]/attachments?attachmentId=...
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const attachmentId = searchParams.get('attachmentId')
    if (!attachmentId) {
      return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
    }

    const isAdmin = session.user.role === 'ADMIN'
    const { task, involved } = await getInvolvement(params.id, session.user.id, isAdmin)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    if (!involved) {
      return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })
    }

    await prisma.taskAttachment.deleteMany({
      where: { id: attachmentId, taskId: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing attachment:', error)
    return NextResponse.json({ error: 'Failed to remove attachment' }, { status: 500 })
  }
}
