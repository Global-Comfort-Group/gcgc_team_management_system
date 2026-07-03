import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { isTaskOverdue } from '@/lib/overdue'

export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only leaders (and admins) can view workload
    const role = session.user.role
    if (role !== 'LEADER' && role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let uniqueUsers: Array<{
      id: string
      name: string | null
      email: string
      image: string | null
      role: string
      positionTitle: string | null
      isActive: boolean
    }>

    if (role === 'ADMIN') {
      // Admins see all active users except themselves
      uniqueUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: session.user.id },
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          role: true,
          positionTitle: true,
          isActive: true,
        },
      })
    } else {
      // Leaders: their OWN members are their direct reports in the org hierarchy
      // (User.reportsToId), matching the dashboard's team-members definition.
      // Project "teams" (TeamMember) are deliberately SEPARATE from reports-to and
      // are NOT used here — a leader's workload view shows the people who report to
      // them, not arbitrary team co-members or every member in the system.
      uniqueUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          reportsToId: session.user.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          role: true,
          positionTitle: true,
          isActive: true,
        },
      })
    }

    if (uniqueUsers.length === 0) {
      return NextResponse.json({ workload: [] })
    }

    const memberIds = uniqueUsers.map(u => u.id)

    // Flat assignee model: count every task a member is assigned to via the
    // TaskAssignee set (the de-duped union of direct assignee + team members +
    // collaborators), not just the single legacy assigneeId — so team members
    // and collaborators are credited for their work. @@unique([taskId,userId])
    // guarantees one row per user per task, so no double counting.
    const assigneeRows = await prisma.taskAssignee.findMany({
      where: {
        userId: { in: memberIds },
        task: { isRecurring: false, status: { notIn: ['CANCELLED', 'BACKLOG'] } },
      },
      select: {
        userId: true,
        task: { select: { status: true, dueDate: true, memberSubmittedAt: true } },
      },
    })

    const statsByUser = new Map<string, { byStatus: Record<string, number>; total: number; overdue: number }>()
    for (const row of assigneeRows) {
      let s = statsByUser.get(row.userId)
      if (!s) {
        s = { byStatus: {}, total: 0, overdue: 0 }
        statsByUser.set(row.userId, s)
      }
      const st = row.task.status
      s.byStatus[st] = (s.byStatus[st] || 0) + 1
      s.total += 1
      if (isTaskOverdue(row.task)) {
        s.overdue += 1
      }
    }

    // Build per-user stats
    const workload = uniqueUsers.map(user => {
      const s = statsByUser.get(user.id)
      const byStatus = s?.byStatus ?? {}
      return {
        ...user,
        tasks: {
          total: s?.total ?? 0,
          todo: byStatus['TODO'] || 0,
          inProgress: byStatus['IN_PROGRESS'] || 0,
          inReview: byStatus['IN_REVIEW'] || 0,
          completed: byStatus['COMPLETED'] || 0,
          overdue: s?.overdue ?? 0,
        },
      }
    })

    // Sort: overdue first, then by active task count
    workload.sort((a, b) => {
      if (b.tasks.overdue !== a.tasks.overdue) return b.tasks.overdue - a.tasks.overdue
      const aActive = a.tasks.todo + a.tasks.inProgress + a.tasks.inReview
      const bActive = b.tasks.todo + b.tasks.inProgress + b.tasks.inReview
      return bActive - aActive
    })

    return NextResponse.json({ workload })
  } catch (error) {
    console.error('Workload API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
