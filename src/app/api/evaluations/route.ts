import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { resolveLeaderRoster } from '@/lib/leader-roster'

const createEvaluationSchema = z.object({
  evaluateeId: z.string().cuid('Invalid user ID'),
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY']),
  gradientScore: z.number().int().refine(v => [0, 25, 50, 75, 100].includes(v), {
    message: 'Score must be 0, 25, 50, 75, or 100'
  }),
  comments: z.string().max(2000).optional(),
  periodStartDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  periodEndDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  taskId: z.string().cuid().optional().nullable(),
})

// GET /api/evaluations
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const evaluateeId = searchParams.get('evaluateeId')
    const evaluatorId = searchParams.get('evaluatorId')
    const period = searchParams.get('period')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const where: any = {}
    if (evaluateeId) where.evaluateeId = evaluateeId
    if (evaluatorId) where.evaluatorId = evaluatorId
    if (period) where.period = period

    // Members can only see their own evaluations
    if (session.user.role === 'MEMBER') {
      where.evaluateeId = session.user.id
    }

    const [evaluations, total] = await Promise.all([
      prisma.taskEvaluation.findMany({
        where,
        include: {
          evaluator: { select: { id: true, name: true, email: true, image: true, role: true } },
          evaluatee: { select: { id: true, name: true, email: true, image: true, role: true } },
          task: { select: { id: true, title: true, status: true } },
        },
        orderBy: { evaluatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.taskEvaluation.count({ where })
    ])

    return NextResponse.json({ evaluations, total, page, limit })
  } catch (error) {
    console.error('Error fetching evaluations:', error)
    return NextResponse.json({ error: 'Failed to fetch evaluations' }, { status: 500 })
  }
}

// POST /api/evaluations
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only leaders and admins can create evaluations
    if (session.user.role !== 'ADMIN' && session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders and admins can create evaluations' }, { status: 403 })
    }

    const body = await request.json()
    const data = createEvaluationSchema.parse(body)

    // A leader may only evaluate their own team members (same roster as the
    // New Evaluation picker and Member Management).
    if (session.user.role === 'LEADER') {
      const roster = await resolveLeaderRoster(session.user.id)
      if (!roster.memberIds.includes(data.evaluateeId)) {
        return NextResponse.json({ error: 'You can only evaluate members of your own team.' }, { status: 403 })
      }
    }

    const evaluation = await prisma.taskEvaluation.create({
      data: {
        evaluatorId: session.user.id,
        evaluateeId: data.evaluateeId,
        period: data.period,
        gradientScore: data.gradientScore,
        comments: data.comments,
        periodStartDate: new Date(data.periodStartDate),
        periodEndDate: new Date(data.periodEndDate),
        taskId: data.taskId || null,
      },
      include: {
        evaluator: { select: { id: true, name: true, email: true, image: true } },
        evaluatee: { select: { id: true, name: true, email: true, image: true } },
        task: { select: { id: true, title: true } },
      }
    })

    return NextResponse.json({ evaluation }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error('Error creating evaluation:', error)
    return NextResponse.json({ error: 'Failed to create evaluation' }, { status: 500 })
  }
}
