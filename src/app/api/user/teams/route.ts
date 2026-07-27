import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { roundBoardProgress, BOARD_PROGRESS_EXCLUDED_STATUSES } from '@/lib/board-progress'

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  // Optional per-user category for the team's board, applied to the creator's
  // switcher only. Blank = no category.
  category: z.string().trim().max(60).optional(),
})

const teamInclude = {
  members: {
    include: { user: { select: { id: true, name: true, email: true, image: true, role: true } } },
  },
  board: { select: { id: true, name: true, color: true } },
  _count: { select: { members: true, tasks: true } },
}

// GET /api/user/teams — teams the current user belongs to (any role).
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const teams = await prisma.team.findMany({
    where: { members: { some: { userId: session.user.id } } },
    include: teamInclude,
    orderBy: { createdAt: 'desc' },
  })

  // Overall completion % for each team's board (filter-independent).
  const boardIds = teams.map((t) => t.board?.id).filter((id): id is string => !!id)
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
  const withProgress = teams.map((t) => ({
    ...t,
    board: t.board ? { ...t.board, progress: progressMap.get(t.board.id) ?? 0 } : null,
  }))
  return NextResponse.json({ teams: withProgress })
}

// POST /api/user/teams — any authenticated user can create a team; they become its first LEADER.
// Atomically creates the Team, the owner's LEADER membership, and the team's board.
export async function POST(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { name, description, color, category } = createTeamSchema.parse(await req.json())
    const categoryValue = category && category.length > 0 ? category : null

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name,
          description,
          ownerId: session.user.id,
          members: { create: { userId: session.user.id, role: 'LEADER' } },
          board: { create: { name, color, ownerId: session.user.id } },
        },
        include: teamInclude,
      })

      // If the creator picked a category, attach it to their own board pin so
      // the new board lands under that category in their switcher.
      if (categoryValue && created.board) {
        await tx.boardPin.create({
          data: {
            userId: session.user.id,
            boardId: created.board.id,
            category: categoryValue,
            starred: false,
          },
        })
      }

      await tx.activity.create({
        data: {
          type: 'TEAM_JOINED',
          description: `Created team: ${name}`,
          userId: session.user.id,
          entityId: created.id,
          entityType: 'team',
        },
      })

      return created
    })

    return NextResponse.json({ team }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('User teams POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
