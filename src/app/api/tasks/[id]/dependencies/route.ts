import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTaskInvolvement, canViewTask } from '@/lib/task-access'
import { z } from 'zod'

const addDependencySchema = z.object({
  dependsOnId: z.string().cuid('Invalid task ID'),
})

// GET /api/tasks/[id]/dependencies
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization: only people involved in this task may view/modify its
    // dependencies (prevents IDOR via a guessed/known task id).
    const { task: accessTask, allowed: involved } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!accessTask) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!involved) return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })

    const [blockedBy, blocking] = await Promise.all([
      prisma.taskDependency.findMany({
        where: { taskId: params.id },
        include: {
          dependsOn: {
            select: { id: true, title: true, status: true, priority: true, dueDate: true }
          }
        }
      }),
      prisma.taskDependency.findMany({
        where: { dependsOnId: params.id },
        include: {
          task: {
            select: { id: true, title: true, status: true, priority: true, dueDate: true }
          }
        }
      })
    ])

    return NextResponse.json({
      blockedBy: blockedBy.map(d => d.dependsOn),
      blocking: blocking.map(d => d.task)
    })
  } catch (error) {
    console.error('Error fetching dependencies:', error)
    return NextResponse.json({ error: 'Failed to fetch dependencies' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/dependencies
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization: only people involved in this task may view/modify its
    // dependencies (prevents IDOR via a guessed/known task id).
    const { task: accessTask, involved } = await getTaskInvolvement(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!accessTask) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!involved) return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })

    const body = await request.json()
    const { dependsOnId } = addDependencySchema.parse(body)

    if (dependsOnId === params.id) {
      return NextResponse.json({ error: 'A task cannot depend on itself' }, { status: 400 })
    }

    // Check target task exists
    const dependsOnTask = await prisma.task.findUnique({ where: { id: dependsOnId } })
    if (!dependsOnTask) {
      return NextResponse.json({ error: 'Target task not found' }, { status: 404 })
    }

    // Check for circular dependency
    const wouldCreateCycle = await checkCircularDependency(params.id, dependsOnId)
    if (wouldCreateCycle) {
      return NextResponse.json({ error: 'This dependency would create a circular chain' }, { status: 400 })
    }

    const dependency = await prisma.taskDependency.upsert({
      where: { taskId_dependsOnId: { taskId: params.id, dependsOnId } },
      create: { taskId: params.id, dependsOnId },
      update: {},
      include: {
        dependsOn: {
          select: { id: true, title: true, status: true, priority: true, dueDate: true }
        }
      }
    })

    return NextResponse.json({ dependency: dependency.dependsOn }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error('Error adding dependency:', error)
    return NextResponse.json({ error: 'Failed to add dependency' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]/dependencies?dependsOnId=...
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization: only people involved in this task may view/modify its
    // dependencies (prevents IDOR via a guessed/known task id).
    const { task: accessTask, involved } = await getTaskInvolvement(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!accessTask) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    if (!involved) return NextResponse.json({ error: 'You are not involved in this task' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const dependsOnId = searchParams.get('dependsOnId')
    if (!dependsOnId) {
      return NextResponse.json({ error: 'dependsOnId is required' }, { status: 400 })
    }

    await prisma.taskDependency.deleteMany({
      where: { taskId: params.id, dependsOnId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing dependency:', error)
    return NextResponse.json({ error: 'Failed to remove dependency' }, { status: 500 })
  }
}

async function checkCircularDependency(taskId: string, proposedDependsOnId: string): Promise<boolean> {
  // BFS: starting from proposedDependsOnId, check if taskId is reachable
  const visited = new Set<string>()
  const queue = [proposedDependsOnId]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === taskId) return true
    if (visited.has(current)) continue
    visited.add(current)
    const deps = await prisma.taskDependency.findMany({
      where: { taskId: current },
      select: { dependsOnId: true }
    })
    queue.push(...deps.map(d => d.dependsOnId))
  }
  return false
}
