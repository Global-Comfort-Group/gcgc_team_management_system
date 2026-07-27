import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canManageBoard } from '@/lib/board-statuses'
import { accessibleBoardWhere } from '@/lib/board-access'
import {
  resolveBoardActual,
  roundBoardProgress,
  BOARD_PROGRESS_EXCLUDED_STATUSES,
} from '@/lib/board-progress'

// Average finished-task % for a board's top-level, non-parked tasks.
async function taskAverage(boardId: string): Promise<number> {
  const agg = await prisma.task.aggregate({
    where: {
      boardId,
      parentId: null,
      status: { notIn: [...BOARD_PROGRESS_EXCLUDED_STATUSES] },
    },
    _avg: { progressPercentage: true },
  })
  return roundBoardProgress(agg._avg.progressPercentage)
}

async function buildProjectInfo(boardId: string, canManage: boolean) {
  const [board, measurements, quarterTargets, taskAveragePercent] = await Promise.all([
    prisma.kanbanBoard.findUnique({ where: { id: boardId }, select: { manualActualPercent: true } }),
    prisma.boardMeasurement.findMany({ where: { boardId }, orderBy: { position: 'asc' } }),
    prisma.boardQuarterTarget.findMany({ where: { boardId }, orderBy: [{ year: 'asc' }, { quarter: 'asc' }] }),
    taskAverage(boardId),
  ])
  const manualActualPercent = board?.manualActualPercent ?? null
  const actualPercent = resolveBoardActual({ manualActualPercent, measurements, taskAveragePercent })
  return { measurements, quarterTargets, manualActualPercent, taskAveragePercent, actualPercent, canManage }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const board = await prisma.kanbanBoard.findFirst({
    where: { id: params.id, ...accessibleBoardWhere(session.user.id) },
    select: { id: true },
  })
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })

  const canManage = await canManageBoard(prisma, session.user.id, session.user.role, params.id)
  return NextResponse.json(await buildProjectInfo(params.id, canManage))
}

const putSchema = z.object({
  manualActualPercent: z.number().int().min(0).max(100).nullable().optional(),
  measurements: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        weight: z.number().int().min(0).max(100),
        progress: z.number().int().min(0).max(100),
      })
    )
    .max(30)
    .optional(),
  quarterTargets: z
    .array(
      z.object({
        year: z.number().int().min(2000).max(2100),
        quarter: z.number().int().min(1).max(4),
        targetPercent: z.number().int().min(0).max(100),
        actualPercent: z.number().int().min(0).max(100).nullable().optional(),
      })
    )
    .max(40)
    .optional(),
})

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageBoard(prisma, session.user.id, session.user.role, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: z.infer<typeof putSchema>
  try {
    body = putSchema.parse(await req.json())
  } catch (e) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    if (body.manualActualPercent !== undefined) {
      await tx.kanbanBoard.update({
        where: { id: params.id },
        data: { manualActualPercent: body.manualActualPercent },
      })
    }
    if (body.measurements) {
      // Replace the whole set — the editor sends the full list.
      await tx.boardMeasurement.deleteMany({ where: { boardId: params.id } })
      if (body.measurements.length > 0) {
        await tx.boardMeasurement.createMany({
          data: body.measurements.map((m, i) => ({
            boardId: params.id,
            name: m.name,
            weight: m.weight,
            progress: m.progress,
            position: i,
          })),
        })
      }
    }
    if (body.quarterTargets) {
      for (const q of body.quarterTargets) {
        await tx.boardQuarterTarget.upsert({
          where: { boardId_year_quarter: { boardId: params.id, year: q.year, quarter: q.quarter } },
          update: { targetPercent: q.targetPercent, actualPercent: q.actualPercent ?? null },
          create: {
            boardId: params.id,
            year: q.year,
            quarter: q.quarter,
            targetPercent: q.targetPercent,
            actualPercent: q.actualPercent ?? null,
          },
        })
      }
    }
  })

  return NextResponse.json(await buildProjectInfo(params.id, true))
}
