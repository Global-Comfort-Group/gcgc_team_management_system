import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/get-admin-session'
import { prisma } from '@/lib/prisma'
import { UserRole } from '@prisma/client'
import { OVERDUE_EXCLUDED_STATUSES, isTaskOverdue } from '@/lib/overdue'

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession(req)

    if (!session?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get pagination parameters
    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1')
    const limit = parseInt(url.searchParams.get('limit') || '5')
    const skip = (page - 1) * limit

    // Get current date for calculations
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)

    // Basic user counts + task counts
    const [
      totalUsers,
      newUsersThisMonth,
      newUsersLastMonth,
      activeUsers,
      leaderCount,
      memberCount,
      totalTeams,
      totalSections,
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      overdueTasks
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { createdAt: { gte: startOfMonth } }
      }),
      prisma.user.count({
        where: {
          createdAt: {
            gte: startOfLastMonth,
            lt: startOfMonth
          }
        }
      }),
      prisma.user.count({
        where: { isActive: true }
      }),
      prisma.user.count({
        where: { role: UserRole.LEADER }
      }),
      prisma.user.count({
        where: { role: UserRole.MEMBER }
      }),
      prisma.team.count({
        where: { isActive: true }
      }),
      prisma.section.count({
        where: { isActive: true }
      }),
      prisma.task.count({ where: { isRecurring: { not: true } } }),
      prisma.task.count({ where: { isRecurring: { not: true }, status: 'COMPLETED' } }),
      prisma.task.count({ where: { isRecurring: { not: true }, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { isRecurring: { not: true }, status: 'TODO' } }),
      (async () => {
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
        const [activeOverdue, inReviewCandidates] = await Promise.all([
          prisma.task.count({
            where: {
              isRecurring: { not: true },
              status: { notIn: OVERDUE_EXCLUDED_STATUSES },
              dueDate: { lt: startOfToday }
            }
          }),
          // In Review tasks submitted AFTER their due date still count as
          // overdue. Prisma can't compare two columns, so fetch and filter.
          prisma.task.findMany({
            where: { isRecurring: { not: true }, status: 'IN_REVIEW', dueDate: { lt: startOfToday } },
            select: { status: true, dueDate: true, memberSubmittedAt: true }
          })
        ])
        return activeOverdue + inReviewCandidates.filter(t => isTaskOverdue(t)).length
      })()
    ])

    // Hierarchy distribution
    const hierarchyData = await prisma.user.groupBy({
      by: ['hierarchyLevel'],
      _count: {
        hierarchyLevel: true
      },
      where: {
        hierarchyLevel: { not: null }
      }
    })

    const hierarchyDistribution = hierarchyData.map(item => ({
      level: item.hierarchyLevel || 'None',
      count: item._count.hierarchyLevel,
      percentage: totalUsers > 0 ? (item._count.hierarchyLevel / totalUsers) * 100 : 0
    }))

    // User growth by month (last 12 months)
    const userGrowth = []
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)

      const usersInMonth = await prisma.user.count({
        where: {
          createdAt: {
            gte: monthDate,
            lt: nextMonth
          }
        }
      })

      // Calculate change from previous month
      let change = 0
      if (userGrowth.length > 0) {
        const prevMonth = userGrowth[userGrowth.length - 1]
        change = usersInMonth - prevMonth.users
      }

      userGrowth.push({
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        users: usersInMonth,
        change
      })
    }

    // Recent users with pagination
    const [recentUsers, totalRecentUsers] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          hierarchyLevel: true,
          createdAt: true,
          isActive: true
        }
      }),
      prisma.user.count()
    ])

    // Calculate growth rate (avoiding division by zero)
    const growthRate = newUsersLastMonth > 0
      ? ((newUsersThisMonth - newUsersLastMonth) / newUsersLastMonth) * 100
      : newUsersThisMonth > 0 ? 100 : 0

    const stats = {
      totalUsers,
      newUsersThisMonth,
      newUsersLastMonth,
      activeUsers,
      leaderCount,
      memberCount,
      totalTeams,
      totalSections,
      growthRate,
      totalTasks,
      completedTasks,
      inProgressTasks,
      todoTasks,
      overdueTasks,
      hierarchyDistribution,
      userGrowth,
      recentUsers: {
        data: recentUsers.map(user => ({
          ...user,
          createdAt: user.createdAt.toISOString()
        })),
        pagination: {
          page,
          limit,
          total: totalRecentUsers,
          totalPages: Math.ceil(totalRecentUsers / limit),
          hasMore: skip + limit < totalRecentUsers
        }
      }
    }

    return NextResponse.json({ stats })
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
