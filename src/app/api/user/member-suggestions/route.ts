import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { CLOSED_TASK_STATUSES } from '@/lib/task-scope'
import { isTaskOverdue } from '@/lib/overdue'
import { resolveLeaderRoster, annotateMemberSource } from '@/lib/leader-roster'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role || session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders can access member suggestions' }, { status: 403 })
    }

    // Same roster as /api/user/team-members — reports-to UNION the teams this
    // leader manages. Both endpoints feed the one Member Management page, so a
    // narrower roster here would leave team-sourced members with no health
    // badges and a workload of zero.
    const teamIdFilter = new URL(req.url).searchParams.get('teamId')
    const roster = await resolveLeaderRoster(session.user.id, teamIdFilter)

    const teamMembers = roster.memberIds.length > 0 ? await prisma.user.findMany({
      where: {
        id: { in: roster.memberIds },
        isActive: true
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        image: true,
        role: true,
        hierarchyLevel: true,
        contactNumber: true,
        positionTitle: true,
        isActive: true,
        createdAt: true,
        reportsToId: true,
        assignedTasks: {
          where: {
            status: { notIn: [...CLOSED_TASK_STATUSES] }
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueDate: true,
            startDate: true,
            memberSubmittedAt: true,
            progressPercentage: true,
            taskType: true,
            createdAt: true,
            updatedAt: true
          },
          orderBy: [
            { dueDate: 'asc' },
            { priority: 'desc' },
            { createdAt: 'desc' }
          ]
        }
      },
      orderBy: [
        { name: 'asc' },
        { email: 'asc' }
      ]
    }) : []

    // Calculate task counts and availability scores for each member
    const membersWithStats = teamMembers.map(rawMember => {
      const member = annotateMemberSource(rawMember, roster)
      const tasks = member.assignedTasks
      
      // Count tasks by status
      const taskCounts = {
        todo: tasks.filter(t => t.status === 'TODO').length,
        inProgress: tasks.filter(t => t.status === 'IN_PROGRESS').length,
        inReview: tasks.filter(t => t.status === 'IN_REVIEW').length,
        total: tasks.length
      }

      // Count tasks by priority
      const priorityCounts = {
        urgent: tasks.filter(t => t.priority === 'URGENT').length,
        high: tasks.filter(t => t.priority === 'HIGH').length,
        medium: tasks.filter(t => t.priority === 'MEDIUM').length,
        low: tasks.filter(t => t.priority === 'LOW').length
      }

      // Calculate overdue tasks
      const now = new Date()
      const overdueTasks = tasks.filter(t => isTaskOverdue(t, now)).length

      // Calculate availability score (lower is better - more available)
      // Formula: total tasks + (urgent * 3) + (high * 2) + overdue tasks + (in_progress * 1.5)
      const availabilityScore = 
        taskCounts.total + 
        (priorityCounts.urgent * 3) + 
        (priorityCounts.high * 2) + 
        overdueTasks + 
        (taskCounts.inProgress * 1.5)

      // Calculate workload percentage (rough estimate)
      const maxExpectedTasks = 10 // Assume 10 is a reasonable max
      const workloadPercentage = Math.min((taskCounts.total / maxExpectedTasks) * 100, 100)

      return {
        ...member,
        taskCounts,
        priorityCounts,
        overdueTasks,
        availabilityScore,
        workloadPercentage,
        assignedTasks: tasks
      }
    })

    // Sort by availability score (ascending - most available first)
    membersWithStats.sort((a, b) => a.availabilityScore - b.availabilityScore)

    // Get the most available member (suggestion)
    const suggestedMember = membersWithStats.length > 0 ? membersWithStats[0] : null

    return NextResponse.json({
      members: membersWithStats,
      suggestedMember,
      total: membersWithStats.length
    })
  } catch (error) {
    console.error('Member suggestions GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
