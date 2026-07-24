import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageBoard } from '@/lib/board-statuses'
import { accessibleBoardWhere } from '@/lib/board-access'

const userSelect = { id: true, name: true, firstName: true, lastName: true, email: true, image: true, role: true }

// GET — the board's reviewer pool. Anyone with access to the board may read it
// (submitters need it to pick a reviewer). Board managers additionally get the
// list of leaders they can add (`candidates`).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const board = await prisma.kanbanBoard.findFirst({
    where: { id: params.id, ...accessibleBoardWhere(session.user.id) },
    select: { id: true },
  })
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

  const pool = await prisma.boardReviewer.findMany({
    where: { boardId: params.id },
    select: { user: { select: userSelect } },
    orderBy: { createdAt: 'asc' },
  })
  const reviewers = pool.map((r) => r.user)

  let candidates: typeof reviewers | undefined
  if (await canManageBoard(prisma, session.user.id, session.user.role, params.id)) {
    const inPool = new Set(reviewers.map((u) => u.id))
    const leaders = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['LEADER', 'ADMIN'] } },
      select: userSelect,
      orderBy: { name: 'asc' },
    })
    candidates = leaders.filter((u) => !inPool.has(u.id))
  }

  return NextResponse.json({ reviewers, ...(candidates ? { candidates } : {}) })
}

// POST — add a leader to the board's reviewer pool. Board managers only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } })
  if (!user || !user.isActive || (user.role !== 'LEADER' && user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Only active leaders can be reviewers.' }, { status: 400 })
  }

  await prisma.boardReviewer.upsert({
    where: { boardId_userId: { boardId: params.id, userId } },
    update: {},
    create: { boardId: params.id, userId },
  })
  return NextResponse.json({ ok: true })
}

// DELETE — remove a leader from the pool (?userId=). Board managers only.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  await prisma.boardReviewer.deleteMany({ where: { boardId: params.id, userId } })
  return NextResponse.json({ ok: true })
}
