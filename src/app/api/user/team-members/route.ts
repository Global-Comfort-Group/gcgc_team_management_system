import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { CLOSED_TASK_STATUSES, COMPLETED_WORK_WHERE } from '@/lib/task-scope'
import { resolveLeaderRoster, annotateMemberSource } from '@/lib/leader-roster'

export const dynamic = 'force-dynamic'

const addMemberSchema = z.object({
  userId: z.string().min(1)
})

export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role || session.user.role === 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // MEMBER: return teammates (people who share the same leader) + their leaders
    if (session.user.role === 'MEMBER') {
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { memberOfLeaders: { select: { leaderId: true } } }
      })
      const leaderIds = currentUser?.memberOfLeaders.map(m => m.leaderId) || []

      const teammates = await prisma.user.findMany({
        where: {
          OR: [
            { memberOfLeaders: { some: { leaderId: { in: leaderIds } } }, id: { not: session.user.id } },
            { id: { in: leaderIds } }
          ],
          isActive: true
        },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          name: true, image: true, role: true, positionTitle: true,
          isActive: true, createdAt: true, reportsToId: true,
          _count: { select: { assignedTasks: { where: { status: { notIn: [...CLOSED_TASK_STATUSES] } } } } }
        },
        orderBy: [{ name: 'asc' }, { email: 'asc' }]
      })
      return NextResponse.json({ members: teammates, stats: { totalMembers: teammates.length, activeTasks: 0, completedTasks: 0, overdueTasks: 0 } })
    }

    // LEADER: the roster is the union of reports-to and the teams this leader
    // manages — see src/lib/leader-roster.ts for why the two are separate and
    // why reading only the first made team-added people invisible here.
    const teamIdFilter = new URL(req.url).searchParams.get('teamId')
    const roster = await resolveLeaderRoster(session.user.id, teamIdFilter)

    const loaded = roster.memberIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: roster.memberIds }, isActive: true },
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
        _count: {
          select: {
            assignedTasks: {
              where: { status: { notIn: [...CLOSED_TASK_STATUSES] } }
            }
          }
        }
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }]
    }) : []

    const teamMembers = loaded.map(m => annotateMemberSource(m, roster))

    // Get team statistics
    const memberIds = teamMembers.map(member => member.id)
    
    const [activeTasks, completedTasks, overdueTasks] = await Promise.all([
      // Active tasks assigned to team members
      prisma.task.count({
        where: {
          assigneeId: { in: memberIds },
          status: { notIn: [...CLOSED_TASK_STATUSES] }
        }
      }),
      
      // Completed tasks this month
      prisma.task.count({
        where: {
          assigneeId: { in: memberIds },
          AND: [COMPLETED_WORK_WHERE],
          updatedAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      }),
      
      // Overdue tasks
      prisma.task.count({
        where: {
          assigneeId: { in: memberIds },
          dueDate: { lt: (() => { const d = new Date(); d.setHours(0,0,0,0); return d })() },
          status: { notIn: [...CLOSED_TASK_STATUSES] }
        }
      })
    ])

    const stats = {
      totalMembers: teamMembers.length,
      activeTasks,
      completedTasks,
      overdueTasks
    }

    return NextResponse.json({
      members: teamMembers,
      teams: roster.managedTeams,
      stats
    })
  } catch (error) {
    console.error('Team members GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role || session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders can add team members' }, { status: 403 })
    }

    const body = await req.json()
    const { userId } = addMemberSchema.parse(body)

    // Check if user exists and is not already assigned to someone
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        name: true,
        image: true,
        role: true,
        reportsToId: true,
        isActive: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!user.isActive) {
      return NextResponse.json({ error: 'User is not active' }, { status: 400 })
    }

    if (user.id === session.user.id) {
      return NextResponse.json({ error: 'You cannot add yourself as a team member' }, { status: 400 })
    }

    // Check if already in this leader's team
    const existingMembership = await prisma.leaderMembership.findUnique({
      where: { leaderId_memberId: { leaderId: session.user.id, memberId: userId } }
    })
    if (existingMembership) {
      return NextResponse.json({ error: 'User is already in your team' }, { status: 400 })
    }

    // Create LeaderMembership; also set reportsToId if user has no primary leader yet
    const [, updatedUser] = await prisma.$transaction([
      prisma.leaderMembership.create({
        data: { leaderId: session.user.id, memberId: userId }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { reportsToId: user.reportsToId ?? session.user.id },
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
          _count: {
            select: {
              assignedTasks: {
                where: {
                  status: { notIn: [...CLOSED_TASK_STATUSES] }
                }
              }
            }
          }
        }
      })
    ])

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'TEAM_JOINED',
        description: `Added ${user.name || user.email} to team`,
        userId: session.user.id,
        entityId: user.id,
        entityType: 'user',
      }
    })

    return NextResponse.json(updatedUser, { status: 201 })
  } catch (error) {
    console.error('Add team member error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
