import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTaskInvolvement, canViewTask } from '@/lib/task-access'
import { uploadToOSS } from '@/lib/oss'

const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.dll', '.so',
  '.com', '.msi', '.vbs', '.js', '.jse', '.wsf', '.wsh',
  '.scr', '.pif', '.reg', '.jar', '.app',
]
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// GET /api/tasks/[id]/procurement
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only people involved in the task may read its procurement records.
    const { task, allowed: involved } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!involved) return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })

    const procurements = await prisma.taskProcurement.findMany({
      where: { taskId: params.id },
      include: {
        createdBy: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ procurements })
  } catch (error) {
    console.error('Error fetching procurements:', error)
    return NextResponse.json({ error: 'Failed to fetch procurements' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/procurement  (multipart/form-data)
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { task, involved } = await getTaskInvolvement(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!involved) return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })

    const formData = await request.formData()
    const type = formData.get('type') as string
    const notes = (formData.get('notes') as string) || undefined
    const file = formData.get('file') as File | null

    if (!type || !['PURCHASE_REQUEST', 'PURCHASE_ORDER'].includes(type)) {
      return NextResponse.json({ error: 'Invalid procurement type' }, { status: 400 })
    }

    let fileFields: {
      fileUrl?: string
      fileName?: string
      fileSize?: number
      fileType?: string
      objectKey?: string
    } = {}

    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large. Maximum size is 50MB.' }, { status: 400 })
      }

      const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const extension = '.' + (originalName.split('.').pop()?.toLowerCase() || '')
      if (BLOCKED_EXTENSIONS.includes(extension)) {
        return NextResponse.json({ error: 'This file type is not allowed.' }, { status: 400 })
      }

      const timestamp = Date.now()
      const sanitizedName = originalName.substring(0, 100)
      const objectKey = `procurement/${params.id}/${timestamp}-${session.user.id}-${sanitizedName}`

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const { url: fileUrl } = await uploadToOSS(buffer, objectKey, file.type)

      fileFields = {
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        objectKey,
      }
    }

    const procurement = await prisma.taskProcurement.create({
      data: {
        taskId: params.id,
        createdById: session.user.id,
        type: type as 'PURCHASE_REQUEST' | 'PURCHASE_ORDER',
        notes,
        ...fileFields,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true, image: true } },
      },
    })

    return NextResponse.json({ procurement }, { status: 201 })
  } catch (error) {
    console.error('Error creating procurement:', error)
    return NextResponse.json({ error: 'Failed to create procurement' }, { status: 500 })
  }
}
