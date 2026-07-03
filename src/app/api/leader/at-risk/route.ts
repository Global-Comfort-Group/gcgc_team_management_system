import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isTaskOverdue } from '@/lib/overdue'

const NEAR_DEADLINE_DAYS = 3

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user.role !== 'LEADER' && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date()
    const soonCutoff = new Date(now.getTime() + NEAR_DEADLINE_DAYS * 24 * 60 * 60 * 1000)

    // Get teams where this user is a team leader
    const leaderMemberships = await prisma.teamMember.findMany({
      where: {
        userId: session.user.id,
        role: 'LEADER',
      },
      select: { teamId: true },
    })
    const teamIds = leaderMemberships.map(m => m.teamId)

    if (teamIds.length === 0) {
      return NextResponse.json({ tasks: [] })
    }

    const tasks = await prisma.task.findMany({
      where: {
        teamId: { in: teamIds },
        status: { notIn: ['COMPLETED', 'BACKLOG'] },
        dueDate: { not: null, lte: soonCutoff },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        memberSubmittedAt: true,
        assignee: { select: { id: true, name: true, email: true, image: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    })

    const enriched = tasks.map(t => ({
      ...t,
      isOverdue: isTaskOverdue(t, now),
    }))

    return NextResponse.json({ tasks: enriched })
  } catch (error) {
    console.error('At-risk tasks endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
