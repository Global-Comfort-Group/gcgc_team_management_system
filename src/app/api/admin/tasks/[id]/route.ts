import { NextRequest, NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/auth/get-admin-session'
import { prisma } from '@/lib/prisma'
import { TaskStatus } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAdminSession(req)
    
    if (!session?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const task = await prisma.task.findUnique({
      where: { id: params.id },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            hierarchyLevel: true
          }
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            hierarchyLevel: true
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
                hierarchyLevel: true
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
          include: {
            // Comment relates via `author`, not `user`. `user` is not a relation
            // on Comment, so Prisma threw PrismaClientValidationError on every
            // call — this endpoint 500'd unconditionally.
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ task })
  } catch (error) {
    console.error('Error fetching task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAdminSession(req)
    
    if (!session?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { status, priority, dueDate } = body

    // Validate status if provided
    if (status && !Object.values(TaskStatus).includes(status)) {
      return NextResponse.json({ error: 'Invalid task status' }, { status: 400 })
    }

    // Check if task exists
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id }
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const updateData: any = {}
    if (status !== undefined) updateData.status = status
    if (priority !== undefined) updateData.priority = priority
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null

    const updatedTask = await prisma.task.update({
      where: { id: params.id },
      data: updateData,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            hierarchyLevel: true
          }
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            hierarchyLevel: true
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
                hierarchyLevel: true
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
        }
      }
    })

    return NextResponse.json({ task: updatedTask })
  } catch (error) {
    console.error('Error updating task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getAdminSession(req)
    
    if (!session?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if task exists
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id }
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    await prisma.task.delete({
      where: { id: params.id }
    })

    return NextResponse.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Error deleting task:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}