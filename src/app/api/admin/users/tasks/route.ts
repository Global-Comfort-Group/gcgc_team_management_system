import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/get-admin-session'
import { prisma } from '@/lib/prisma'
import { TaskStatus, UserRole } from '@prisma/client'
import { isTaskOverdue } from '@/lib/overdue'

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminSession(req)
    
    if (!session?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // First, let's test if we can get a simple count of all tasks
    const totalTasksCount = await prisma.task.count()
    console.log('Total tasks in database:', totalTasksCount)
    
    if (totalTasksCount === 0) {
      return NextResponse.json({
        tasks: [],
        stats: {
          totalTasks: 0,
          pendingTasks: 0,
          inProgressTasks: 0,
          completedTasks: 0,
          overdueTasks: 0,
          collaborativeTasks: 0,
          teamTasks: 0,
          individualTasks: 0
        },
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasMore: false
        }
      })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') as TaskStatus | null
    const taskType = searchParams.get('taskType') // 'assigned' | 'created' | 'collaborative' | 'all'
    const assigneeId = searchParams.get('assigneeId') || ''

    // Debug search specifically
    if (search) {
      console.log('Search query:', search)
    }

    const skip = (page - 1) * limit

    // Build where condition for tasks
    const taskWhere: any = {
      // Hide recurring template tasks — match false AND null (pre-feature rows)
      isRecurring: { not: true },
    }

    // Filter by assignee if provided (for user-specific task modal)
    if (assigneeId) {
      taskWhere.assigneeId = assigneeId
    }

    // Apply status filter if provided
    if (status && status !== 'all') {
      taskWhere.status = status
    }

    // Apply search filter if provided
    if (search && search.trim()) {
      const userSearchCondition = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      }

      taskWhere.OR = [
        // Tasks assigned to matching users
        { assignee: userSearchCondition },
        // Tasks created by matching users
        { creator: userSearchCondition },
        // Tasks with collaborators matching search
        {
          collaborators: {
            some: {
              user: userSearchCondition
            }
          }
        },
        // Also search in task title and description
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ]
    }

    // Apply task type filter - use the actual taskType field
    if (taskType && taskType !== 'all') {
      switch (taskType) {
        case 'individual':
          taskWhere.taskType = 'INDIVIDUAL'
          break
        case 'collaborative':
          taskWhere.taskType = 'COLLABORATION'
          break
        case 'team':
          taskWhere.taskType = 'TEAM'
          break
      }
    }

    // Only log complex where conditions for debugging
    if (search || Object.keys(taskWhere).length > 0) {
      console.log('Task where condition:', JSON.stringify(taskWhere, null, 2))
    }

    // Get all tasks with their relationships
    const [tasks, totalTasks] = await Promise.all([
      prisma.task.findMany({
        where: taskWhere,
        skip,
        take: limit,
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              hierarchyLevel: true,
              isActive: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              hierarchyLevel: true,
              isActive: true
            }
          },
          collaborators: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  hierarchyLevel: true,
                  isActive: true
                }
              }
            }
          },
          team: {
            select: {
              id: true,
              name: true,
              description: true
            }
          },
          comments: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true
                }
              }
            },
            orderBy: { createdAt: 'desc' },
            take: 3 // Only get recent comments for preview
          },
          _count: {
            select: {
              comments: true,
              collaborators: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.task.count({ where: taskWhere })
    ])

    console.log(`Admin Tasks API: Found ${tasks.length} tasks out of ${totalTasks} total`)

    // Transform tasks to include relationship types and user involvement
    const transformedTasks = tasks.map(task => {
      const involvedUsers = new Set<string>()
      const userRelationships: string[] = []

      // Add assigned user
      if (task.assignee) {
        involvedUsers.add(task.assignee.id)
        userRelationships.push('assignee')
      }

      // Add creator
      if (task.creator) {
        involvedUsers.add(task.creator.id)
        userRelationships.push('creator')
      }

      // Add collaborators
      task.collaborators.forEach(collab => {
        involvedUsers.add(collab.user.id)
        userRelationships.push('collaborator')
      })

      // Check if task is overdue (late-submitted IN_REVIEW tasks stay overdue)
      const isOverdue = isTaskOverdue(task)

      // Determine task type based on relationships
      let taskTypeLabel = 'Individual'
      if (task.collaborators.length > 0) {
        taskTypeLabel = 'Collaborative'
      } else if (task.team) {
        taskTypeLabel = 'Team Task'
      }

      return {
        ...task,
        isOverdue,
        taskType: taskTypeLabel,
        involvedUserCount: Array.from(involvedUsers).length,
        relationshipTypes: Array.from(new Set(userRelationships)),
        allInvolvedUsers: [
          ...(task.assignee ? [{ ...task.assignee, relationship: 'assignee' }] : []),
          ...(task.creator ? [{ ...task.creator, relationship: 'creator' }] : []),
          ...task.collaborators.map(c => ({ ...c.user, relationship: 'collaborator' }))
        ].filter((user, index, self) => 
          index === self.findIndex(u => u.id === user.id)
        )
      }
    })

    // Calculate summary statistics
    const stats = {
      totalTasks,
      pendingTasks: transformedTasks.filter(t => t.status === 'TODO').length,
      inProgressTasks: transformedTasks.filter(t => t.status === 'IN_PROGRESS').length,
      completedTasks: transformedTasks.filter(t => t.status === 'COMPLETED').length,
      overdueTasks: transformedTasks.filter(t => t.isOverdue).length,
      collaborativeTasks: transformedTasks.filter(t => t.taskType === 'Collaborative').length,
      teamTasks: transformedTasks.filter(t => t.taskType === 'Team Task').length,
      individualTasks: transformedTasks.filter(t => t.taskType === 'Individual').length
    }

    const pagination = {
      page,
      limit,
      total: totalTasks,
      totalPages: Math.ceil(totalTasks / limit),
      hasMore: skip + limit < totalTasks
    }

    return NextResponse.json({ 
      tasks: transformedTasks,
      stats,
      pagination 
    })
  } catch (error) {
    console.error('Error fetching user tasks:', error)
    console.error('Error details:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}