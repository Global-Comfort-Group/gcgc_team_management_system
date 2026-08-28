import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { OVERDUE_EXCLUDED_STATUSES, isTaskOverdue } from '@/lib/overdue'
import { myTasksWhere, teamTasksWhere, taskInvolvementOr } from '@/lib/task-scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }

    const userId = session.user.id

    // Get user's teams
    const userTeams = await prisma.teamMember.findMany({
      where: { userId },
      include: { 
        team: { 
          select: { id: true, name: true } 
        } 
      }
    })

    const teamIds = userTeams.map(tm => tm.teamId)

    // 8 weeks back (start of that day) — window for the completion trend chart.
    const trendStart = new Date()
    trendStart.setDate(trendStart.getDate() - 7 * 8)
    trendStart.setHours(0, 0, 0, 0)

    // Every "my ..." count below is built from myTasksWhere so the summary
    // cards match what the Tasks tab actually lists (same involvement clause,
    // top-level only, recurring templates excluded).
    const myScope = myTasksWhere(userId)
    const isLeader = session.user.role === 'LEADER'

    // Get dashboard statistics
    const [
      myTasks,
      myCompletedTasks,
      teamTasks,
      overdueTasks,
      recentTasks,
      teamMembers,
      upcomingDeadlines,
      statusGroups,
      priorityGroups,
      completedRecent,
      teamMembersCount
    ] = await Promise.all([
      // My open tasks
      prisma.task.count({
        where: { ...myScope, status: { notIn: ['COMPLETED', 'CANCELLED', 'BACKLOG'] } }
      }),
      
      // My completed tasks this month
      prisma.task.count({
        where: {
          ...myScope,
          status: 'COMPLETED',
          updatedAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      }),

      // Team tasks (if leader). Scoped via the board too — old tasks on a team
      // board have teamId = null and would otherwise be invisible here.
      isLeader && teamIds.length > 0 ? prisma.task.count({
        where: {
          ...teamTasksWhere(teamIds),
          status: { notIn: ['COMPLETED', 'CANCELLED', 'BACKLOG'] }
        }
      }) : 0,

      // Overdue tasks (excluding subtasks - they're managed within parent task).
      // In Review tasks submitted after their due date still count; Prisma
      // can't compare two columns, so those are fetched and filtered.
      (async () => {
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
        const scope: any = {
          AND: [
            {
              OR: [
                { AND: [{ OR: taskInvolvementOr(userId) }] },
                ...(isLeader && teamIds.length > 0 ? [teamTasksWhere(teamIds)] : [])
              ]
            }
          ],
          isRecurring: false,
          dueDate: { lt: startOfToday },
          parentId: null // Only count parent tasks, not subtasks
        }
        const [activeOverdue, inReviewCandidates] = await Promise.all([
          prisma.task.count({
            where: { ...scope, status: { notIn: OVERDUE_EXCLUDED_STATUSES } }
          }),
          prisma.task.findMany({
            where: { ...scope, status: 'IN_REVIEW' },
            select: { status: true, dueDate: true, memberSubmittedAt: true }
          })
        ])
        return activeOverdue + inReviewCandidates.filter(t => isTaskOverdue(t)).length
      })(),

      // Recent tasks (last 5)
      prisma.task.findMany({
        where: {
          isRecurring: false,
          parentId: null,
          OR: [
            ...taskInvolvementOr(userId),
            ...(isLeader && teamIds.length > 0 ? [teamTasksWhere(teamIds)] : [])
          ]
        },
        include: {
          assignee: {
            select: { 
              id: true, 
              firstName: true, 
              lastName: true, 
              name: true, 
              email: true,
              image: true 
            }
          },
          creator: {
            select: { 
              id: true, 
              firstName: true, 
              lastName: true, 
              name: true, 
              email: true,
              image: true 
            }
          },
          team: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),

      // Team members preview (if leader). Sourced from LeaderMembership — the
      // same relation Member Management reads — so the two pages agree. The
      // headline count is a separate count() below; this list is capped at 10
      // and must never be used to derive it.
      isLeader ? prisma.user.findMany({
        where: {
          memberOfLeaders: { some: { leaderId: userId } },
          isActive: true
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          image: true,
          role: true,
          updatedAt: true
        },
        take: 10
      }) : [],

      // Upcoming deadlines (next 7 days)
      prisma.task.findMany({
        where: {
          isRecurring: false,
          parentId: null,
          OR: [
            ...taskInvolvementOr(userId),
            ...(isLeader && teamIds.length > 0 ? [teamTasksWhere(teamIds)] : [])
          ],
          dueDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'BACKLOG'] }
        },
        include: {
          assignee: {
            select: { 
              id: true, 
              firstName: true, 
              lastName: true, 
              name: true, 
              email: true,
              image: true 
            }
          },
          team: {
            select: { id: true, name: true }
          }
        },
        orderBy: { dueDate: 'asc' },
        take: 5
      }),

      // My tasks grouped by status (for the status donut)
      prisma.task.groupBy({
        by: ['status'],
        where: myScope,
        _count: { _all: true },
      }),

      // My open tasks grouped by priority (for the priority bar)
      prisma.task.groupBy({
        by: ['priority'],
        where: { ...myScope, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        _count: { _all: true },
      }),

      // My completions over the last 8 weeks (bucketed in JS for the trend line)
      prisma.task.findMany({
        where: { ...myScope, status: 'COMPLETED', updatedAt: { gte: trendStart } },
        select: { updatedAt: true },
      }),

      // Headline team-size figure. Counted separately because the preview list
      // above is capped at 10 — deriving the stat from its length reported "10"
      // for every leader with a team of 10 or more.
      isLeader ? prisma.user.count({
        where: {
          memberOfLeaders: { some: { leaderId: userId } },
          isActive: true
        }
      }) : 0,
    ])

    // ── Shape chart data ──
    const statusBreakdown = (['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'] as const).map((s) => ({
      status: s,
      count: statusGroups.find((g) => g.status === s)?._count._all ?? 0,
    }))

    const priorityBreakdown = (['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => ({
      priority: p,
      count: priorityGroups.find((g) => g.priority === p)?._count._all ?? 0,
    }))

    // Eight weekly buckets, oldest → newest. weekStart anchors each bucket.
    const completionTrend = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(trendStart)
      start.setDate(start.getDate() + i * 7)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const count = completedRecent.filter((t) => t.updatedAt >= start && t.updatedAt < end).length
      return { weekStart: start.toISOString(), label: `${start.getMonth() + 1}/${start.getDate()}`, count }
    })

    return NextResponse.json({
      stats: {
        myTasks,
        myCompletedTasks,
        teamTasks,
        overdueTasks,
        teamMembersCount
      },
      recentTasks,
      teamMembers,
      upcomingDeadlines,
      teams: userTeams.map(tm => tm.team),
      statusBreakdown,
      priorityBreakdown,
      completionTrend,
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
