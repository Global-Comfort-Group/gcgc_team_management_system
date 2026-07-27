import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { seedDefaultBoardStatuses } from '@/lib/board-statuses'
import { roundBoardProgress, BOARD_PROGRESS_EXCLUDED_STATUSES } from '@/lib/board-progress'
import { notifyAddedToBoard } from '@/lib/notifications'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  memberIds: z.array(z.string()).optional(),
})

const memberInclude = {
  members: {
    include: {
      user: { select: { id: true, name: true, email: true, image: true, role: true } },
    },
  },
  statuses: { orderBy: { position: 'asc' as const } },
  fields: { orderBy: { position: 'asc' as const } },
  _count: { select: { tasks: true } },
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const boards = await prisma.kanbanBoard.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { members: { some: { userId: session.user.id } } },
        // Team boards: visible to every member of the owning team.
        { team: { members: { some: { userId: session.user.id } } } },
      ],
    },
    include: {
      ...memberInclude,
      owner: { select: { id: true, name: true, email: true, image: true } },
      team: {
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true, role: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Overall completion % per board: average progress of top-level, non-parked
  // tasks (computed here so it's filter-independent).
  const boardIds = boards.map((b) => b.id)
  const progressRows = boardIds.length
    ? await prisma.task.groupBy({
        by: ['boardId'],
        where: {
          boardId: { in: boardIds },
          parentId: null,
          status: { notIn: [...BOARD_PROGRESS_EXCLUDED_STATUSES] },
        },
        _avg: { progressPercentage: true },
      })
    : []
  const progressMap = new Map(
    progressRows.map((r) => [r.boardId as string, roundBoardProgress(r._avg.progressPercentage)])
  )

  // Attach canManage so the client shows the Board Settings gear only to those
  // who can edit: admins, the board owner, or a team LEADER of the board's team.
  const leaderTeams = await prisma.teamMember.findMany({
    where: { userId: session.user.id, role: 'LEADER' },
    select: { teamId: true },
  })
  const leaderTeamIds = new Set(leaderTeams.map((t) => t.teamId))
  const isAdmin = session.user.role === 'ADMIN'

  // The current user's per-board prefs (star + category) for the switcher.
  const pins = await prisma.boardPin.findMany({
    where: { userId: session.user.id },
    select: { boardId: true, starred: true, category: true },
  })
  const pinMap = new Map(pins.map((p) => [p.boardId, p]))

  const withPerms = boards.map((b) => ({
    ...b,
    canManage: isAdmin || b.ownerId === session.user.id || (!!b.teamId && leaderTeamIds.has(b.teamId)),
    isStarred: !!pinMap.get(b.id)?.starred,
    category: pinMap.get(b.id)?.category ?? null,
    progress: progressMap.get(b.id) ?? 0,
  }))

  return NextResponse.json({ boards: withPerms })
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const { memberIds, ...data } = createSchema.parse(body)

    const created = await prisma.kanbanBoard.create({
      data: {
        ...data,
        ownerId: session.user.id,
        ...(memberIds && memberIds.length > 0
          ? { members: { create: memberIds.map(userId => ({ userId })) } }
          : {}),
      },
      select: { id: true },
    })

    // Seed the four default statuses so the new board has columns to work with.
    await seedDefaultBoardStatuses(prisma, created.id)

    // Event-driven notification: tell each added member (not the creator) they
    // were added to the new board. Best-effort, non-blocking.
    if (memberIds && memberIds.length > 0) {
      const adderName = session.user.name || 'Someone'
      for (const uid of Array.from(new Set(memberIds))) {
        if (uid !== session.user.id) {
          void notifyAddedToBoard(uid, created.id, data.name, adderName).catch(() => {})
        }
      }
    }

    const board = await prisma.kanbanBoard.findUnique({
      where: { id: created.id },
      include: {
        ...memberInclude,
        owner: { select: { id: true, name: true, email: true, image: true } },
      },
    })
    // The creator owns this board, so they can always manage it. Include the
    // flag so the freshly-created board shows the "Customize" gear immediately
    // (the GET list computes this; the create response must too).
    return NextResponse.json({ board: board ? { ...board, canManage: true } : board }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Boards POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
