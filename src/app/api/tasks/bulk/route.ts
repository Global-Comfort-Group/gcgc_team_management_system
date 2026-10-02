import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { Priority, TaskStatus } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canEditTask, canDeleteTask, canChangeTaskStatus, isTeamLeader } from '@/lib/permissions'
import { notifyTaskCompleted, notifyTaskUpdated, notifyTaskSubmittedForReview } from '@/lib/notifications'
import { loadAccessibleBoard, moveTaskAndSubtasks } from '@/lib/task-move'
import { leaderBoardIds } from '@/lib/board-access'

const MAX_BATCH_SIZE = 100

const bulkSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('changeStatus'),
    taskIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_SIZE),
    payload: z.object({ status: z.nativeEnum(TaskStatus) }),
  }),
  z.object({
    type: z.literal('changePriority'),
    taskIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_SIZE),
    payload: z.object({ priority: z.nativeEnum(Priority) }),
  }),
  z.object({
    type: z.literal('delete'),
    taskIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_SIZE),
  }),
  z.object({
    type: z.literal('moveToBoard'),
    taskIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_SIZE),
    payload: z.object({ boardId: z.string().nullable() }), // null = detach from board
  }),
])

interface ActionResult {
  updated: number
  skipped: { id: string; reason: string }[]
  bulkOperationId: string
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id
    const userRole = session.user.role
    if (!userRole) {
      return NextResponse.json({ error: 'User role missing' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const action = parsed.data
    const bulkOperationId = crypto.randomUUID()
    const result: ActionResult = { updated: 0, skipped: [], bulkOperationId }

    // Load every target up front along with the data the permission lib needs.
    const tasks = await prisma.task.findMany({
      where: { id: { in: action.taskIds } },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        boardId: true,
        creatorId: true,
        assigneeId: true,
        assignedById: true,
        taskType: true,
        teamId: true,
        teamMembers: { select: { userId: true } },
        collaborators: { select: { userId: true } },
        assignees: { select: { userId: true } },
        board: { select: { ownerId: true, teamId: true } },
      },
    })
    const tasksById = new Map(tasks.map(t => [t.id, t]))

    // Pre-fetch the actor's TeamMember role for each unique team in one go.
    const teamIds = Array.from(new Set(tasks.flatMap(t => [t.teamId, t.board?.teamId]).filter((x): x is string => !!x)))
    const memberships = teamIds.length
      ? await prisma.teamMember.findMany({
          where: { userId, teamId: { in: teamIds } },
          select: { teamId: true, role: true },
        })
      : []
    const teamRoleByTeamId = new Map(memberships.map(m => [m.teamId, m.role]))
    // Every LEADER working in a board leads its tasks (field reports 2026-09).
    const ledBoardIds = await leaderBoardIds(prisma, userId, userRole)

    // For moveToBoard: validate target-board access once, and precompute the
    // target's default-column-per-category map (used for every moved task).
    let moveTargetTeamId: string | null = null
    let moveStatusMap = new Map<string, string>()
    if (action.type === 'moveToBoard') {
      if (action.payload.boardId) {
        const board = await loadAccessibleBoard(action.payload.boardId, userId, userRole === 'ADMIN')
        if (!board) {
          return NextResponse.json({ error: 'You do not have access to that board' }, { status: 403 })
        }
        moveTargetTeamId = board.teamId
        const defs = await prisma.boardStatus.findMany({
          where: { boardId: action.payload.boardId, isDefault: true },
          select: { id: true, category: true },
        })
        moveStatusMap = new Map(defs.map(d => [d.category as string, d.id]))
      }
    }

    const submitterName = session.user.name || session.user.email || 'Someone'

    for (const id of action.taskIds) {
      const task = tasksById.get(id)
      if (!task) {
        result.skipped.push({ id, reason: 'not found' })
        continue
      }

      const teamMemberRole = task.teamId ? teamRoleByTeamId.get(task.teamId) : undefined
      // A LEADER of the board's team leads its tasks whatever their account role.
      const boardTeamRole = task.board?.teamId ? teamRoleByTeamId.get(task.board.teamId) : undefined
      const isBoardLeader =
        isTeamLeader(boardTeamRole) ||
        (userRole === 'LEADER' && isTeamLeader(teamMemberRole)) ||
        (!!task.boardId && ledBoardIds.has(task.boardId))
      // Owner = board owner, or (for a board-less task) the creator.
      const isOwner = task.board ? task.board.ownerId === userId : task.creatorId === userId
      // Only the task's assignee(s) — not team members/collaborators — may move it.
      const isAssignee = task.assigneeId === userId || task.assignees.some(a => a.userId === userId)

      try {
        if (action.type === 'delete') {
          if (!canDeleteTask(userRole, task.creatorId, userId, task.assignedById ?? undefined, teamMemberRole)) {
            result.skipped.push({ id, reason: 'no permission to delete' })
            continue
          }
          await prisma.task.delete({ where: { id } })
          result.updated++
        } else if (action.type === 'changePriority') {
          const assigneeIds = [task.assigneeId, ...(task.assignees?.map(a => a.userId) || [])].filter((id): id is string => !!id)
          if (!isBoardLeader && !canEditTask(userRole, task.creatorId, assigneeIds, userId, teamMemberRole)) {
            result.skipped.push({ id, reason: 'no permission to edit' })
            continue
          }
          if (task.priority === action.payload.priority) {
            result.skipped.push({ id, reason: 'priority already matches' })
            continue
          }
          await prisma.task.update({
            where: { id },
            data: { priority: action.payload.priority },
          })
          result.updated++
        } else if (action.type === 'changeStatus') {
          if (
            !canChangeTaskStatus({
              isAdmin: userRole === 'ADMIN',
              isAssignee,
              isBoardLeader,
              isOwner,
              targetStatus: action.payload.status,
            })
          ) {
            result.skipped.push({ id, reason: 'no permission to change status' })
            continue
          }
          if (task.status === action.payload.status) {
            result.skipped.push({ id, reason: 'status already matches' })
            continue
          }
          // Completion is a leader/owner approval; assignees can't self-complete.
          const canComplete = userRole === 'ADMIN' || isBoardLeader || isOwner
          if (action.payload.status === 'COMPLETED' && !canComplete) {
            result.skipped.push({ id, reason: 'only the board leader or owner can complete' })
            continue
          }

          const data: Record<string, unknown> = { status: action.payload.status }
          if (action.payload.status === 'IN_REVIEW' && task.status !== 'IN_REVIEW') {
            data.memberSubmittedAt = new Date()
          }
          if (action.payload.status === 'COMPLETED' && task.status !== 'COMPLETED') {
            data.leaderEvaluatedAt = new Date()
            data.progressPercentage = 100
          }
          await prisma.task.update({ where: { id }, data })

          // Fire status-aware notifications to the right party.
          if (action.payload.status === 'IN_REVIEW') {
            const reviewerId = task.assignedById ?? task.creatorId
            if (reviewerId && reviewerId !== userId) {
              await notifyTaskSubmittedForReview(reviewerId, task.id, task.title, submitterName)
            }
          } else if (action.payload.status === 'COMPLETED') {
            if (task.assigneeId && task.assigneeId !== userId) {
              await notifyTaskCompleted(task.assigneeId, task.id, task.title, submitterName)
            }
          } else if (task.assigneeId && task.assigneeId !== userId) {
            await notifyTaskUpdated(
              task.assigneeId,
              task.id,
              task.title,
              submitterName,
              `changed status to ${action.payload.status}`
            )
          }
          result.updated++
        } else if (action.type === 'moveToBoard') {
          const assigneeIds = [task.assigneeId, ...(task.assignees?.map(a => a.userId) || [])].filter((x): x is string => !!x)
          const canMove = userRole === 'ADMIN' || isOwner || canEditTask(userRole, task.creatorId, assigneeIds, userId, teamMemberRole)
          if (!canMove) {
            result.skipped.push({ id, reason: 'no permission to move' })
            continue
          }
          if (task.boardId === action.payload.boardId) {
            result.skipped.push({ id, reason: 'already on that board' })
            continue
          }
          await prisma.$transaction(tx =>
            moveTaskAndSubtasks(tx, id, action.payload.boardId, moveTargetTeamId, moveStatusMap)
          )
          result.updated++
        }
      } catch (err) {
        console.error('Bulk task action error for', id, err)
        result.skipped.push({ id, reason: 'update failed' })
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Bulk tasks endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
