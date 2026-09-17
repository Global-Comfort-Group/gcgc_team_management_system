import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { CLOSED_TASK_STATUSES, COMPLETED_WORK_WHERE } from '@/lib/task-scope'
import { authOptions } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role || session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders can access team member details' }, { status: 403 })
    }

    const { id } = params

    // Get detailed team member information with tasks (multi-leader: verify via LeaderMembership)
    const teamMember = await prisma.user.findFirst({
      where: {
        id: id,
        memberOfLeaders: { some: { leaderId: session.user.id } },
        isActive: true
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        middleName: true,
        name: true,
        image: true,
        role: true,
        hierarchyLevel: true,
        contactNumber: true,
        positionTitle: true,
        username: true,
        shortName: true,
        division: true,
        department: true,
        section: true,
        team: true,
        jobLevel: true,
        isActive: true,
        createdAt: true,
        reportsToId: true,
        assignedTasks: {
          where: {
            status: { notIn: [...CLOSED_TASK_STATUSES] } // Only get active tasks
          },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            dueDate: true,
            startDate: true,
            progressPercentage: true,
            taskType: true,
            createdAt: true,
            updatedAt: true,
            team: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: [
            { dueDate: 'asc' },
            { priority: 'desc' },
            { createdAt: 'desc' }
          ]
        },
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

    if (!teamMember) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
    }

    // Get completed tasks count for this month
    const completedTasksCount = await prisma.task.count({
      where: {
        assigneeId: id,
        AND: [COMPLETED_WORK_WHERE],
        updatedAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) // This month
        }
      }
    })

    // Add completed tasks count to the response
    const memberWithCompletedCount = {
      ...teamMember,
      _count: {
        ...teamMember._count,
        completedTasks: completedTasksCount
      }
    }

    return NextResponse.json(memberWithCompletedCount)
  } catch (error) {
    console.error('Team member details GET error:', error)
    console.error('Error details:', {
      memberId: params.id,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role || session.user.role !== 'LEADER') {
      return NextResponse.json({ error: 'Only leaders can remove team members' }, { status: 403 })
    }

    const { id } = params

    // Verify the member is in this leader's team (multi-leader support)
    const membership = await prisma.leaderMembership.findUnique({
      where: { leaderId_memberId: { leaderId: session.user.id, memberId: id } },
      include: { member: { select: { reportsToId: true } } }
    })

    if (!membership) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
    }

    // Remove the LeaderMembership record
    await prisma.leaderMembership.delete({
      where: { leaderId_memberId: { leaderId: session.user.id, memberId: id } }
    })

    // If this leader was the primary leader (reportsToId), promote next or clear it
    if (membership.member.reportsToId === session.user.id) {
      const nextMembership = await prisma.leaderMembership.findFirst({
        where: { memberId: id },
        orderBy: { joinedAt: 'asc' }
      })
      await prisma.user.update({
        where: { id },
        data: { reportsToId: nextMembership?.leaderId ?? null }
      })
    }

    return NextResponse.json({ message: 'Team member removed successfully' })
  } catch (error) {
    console.error('Team member removal error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}