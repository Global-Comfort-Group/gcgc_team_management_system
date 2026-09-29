import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageBoard, ensureDefaultBoardStatuses } from '@/lib/board-statuses'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(40),
  // Custom statuses pin to one of the four column categories.
  category: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})

// GET — list a board's statuses (ordered).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const statuses = await prisma.boardStatus.findMany({
    where: { boardId: params.id },
    orderBy: { position: 'asc' },
  })
  return NextResponse.json({ statuses })
}

// POST — add a custom status to a board.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { name, category, color } = createSchema.parse(await req.json())

    // A board still on the built-in columns gets its four defaults first, so
    // a custom status is added alongside them rather than replacing them.
    await ensureDefaultBoardStatuses(prisma, params.id)

    const last = await prisma.boardStatus.findFirst({
      where: { boardId: params.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const status = await prisma.boardStatus.create({
      data: {
        boardId: params.id,
        name: name.trim(),
        category,
        color: color || '#94A3B8',
        position: (last?.position ?? -1) + 1,
        isDefault: false,
      },
    })
    return NextResponse.json({ status }, { status: 201 })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'A status with that name already exists on this board.' }, { status: 409 })
    }
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid status data.' }, { status: 400 })
    }
    console.error('Create board status error:', error)
    return NextResponse.json({ error: 'Failed to create status' }, { status: 500 })
  }
}
