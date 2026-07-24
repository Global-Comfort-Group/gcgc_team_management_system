import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { TeamMemberRole } from '@prisma/client'
import { canEditTask, canDeleteTask, canChangeTaskStatus, canFinalizeTask, isTeamLeader } from '@/lib/permissions'
import { autoSyncTask, deleteSyncedTask } from '@/lib/calendar-sync-helper'
import { getNextOccurrenceDate } from '@/lib/recurring'
import { setTaskAssignees } from '@/lib/task-assignees'
import { resolveCanRateWorkQuality } from '@/lib/task-rating'
import { resolveReviewerGate } from '@/lib/board-reviewer'
import { setTaskFieldValues } from '@/lib/task-fields'
import { notifyTaskAssigned, notifyTaskUpdated, notifyTaskCompleted, notifyTaskSubmittedForReview, notifySubtaskAssigned } from '@/lib/notifications'

const updateTaskSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  dueDate: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  taskType: z.enum(['INDIVIDUAL', 'TEAM', 'COLLABORATION', 'CASCADING']).optional(),
  assigneeId: z.string().nullish(),
  teamMemberIds: z.array(z.string()).optional(),
  collaboratorIds: z.array(z.string()).optional(),
  assignedById: z.string().optional(),
  // Board Reviewers: assign/clear the task's reviewer (must be in the board pool).
  reviewerId: z.string().nullish(),
  // Google Calendar-compatible fields
  location: z.string().optional(),
  meetingLink: z.string().url().optional().or(z.literal('')),
  allDay: z.boolean().optional(),
  recurrence: z.string().optional(),
  // Work quality evaluation
  workQuality: z.enum(['NONE', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT']).optional().nullable(),
  seniorWorkQuality: z.enum(['NONE', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT']).optional().nullable(),
  // Gravity / SLA / reminders
  taskWeight: z.number().int().min(1).max(5).optional().nullable(),
  slaHours: z.number().int().min(1).optional().nullable(),
  reminderDays: z.array(z.number().int().min(1)).optional(),
  // Per-board custom status (display column). Category still comes from `status`.
  customStatusId: z.string().nullable().optional(),
  // Per-board custom field values
  fieldValues: z.array(z.object({ fieldId: z.string(), value: z.string().nullable() })).optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const task = await prisma.task.findUnique({
      where: { id: params.id },
      include: {
        assignee: {
          select: { id: true, name: true, email: true, image: true }
        },
        creator: {
          select: { id: true, name: true, email: true, image: true }
        },
        assignedBy: {
          select: { id: true, name: true, email: true, image: true }
        },
        team: {
          select: { id: true, name: true }
        },
        // Board owner determines who can move/finalize the task; teamId scopes
        // who counts as "in the board" for rating (board's team, not task.teamId).
        board: { select: { ownerId: true, teamId: true } },
        teamMembers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true
              }
            }
          }
        },
        collaborators: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true
              }
            }
          }
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true
              }
            }
          }
        },
        reviewer: { select: { id: true, name: true, email: true, image: true } },
        fieldValues: {
          include: { field: { select: { id: true, name: true, type: true, options: true, position: true } } },
        },
        attachments: {
          include: {
            uploadedBy: { select: { id: true, name: true, email: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        comments: {
          include: {
            author: {
              select: { id: true, name: true, email: true, image: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        subtasks: {
          include: {
            assignee: {
              select: { id: true, name: true, email: true, image: true }
            },
            reviewer: {
              select: { id: true, name: true, email: true, image: true }
            }
          },
          orderBy: [{ cascadeOrder: 'asc' }, { createdAt: 'asc' }]
        },
        parent: {
          select: { id: true, title: true, creatorId: true, assigneeId: true }
        },
        _count: {
          select: { subtasks: true }
        }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Check if user has access to this task
    if (session.user.role !== 'ADMIN') {
      // For tasks without teams, check if user is creator, assignee, collaborator,
      // or has an unlocked cascade step on this parent task
      if (!task.teamId) {
        const hasDirectAccess = task.creatorId === session.user.id ||
                         task.assigneeId === session.user.id ||
                         task.teamMembers?.some(tm => tm.userId === session.user.id) ||
                         task.collaborators?.some(c => c.userId === session.user.id)

        let hasAccess = hasDirectAccess
        if (!hasAccess) {
          // A user assigned an unlocked subtask of this parent can view the
          // parent (so they can see and work on their subtask). This matches the
          // list query in /api/tasks, which surfaces the parent to any subtask
          // assignee — applies to regular subtasks as well as cascade steps.
          const subtaskForUser = await prisma.task.findFirst({
            where: { parentId: task.id, assigneeId: session.user.id, isLocked: false }
          })
          hasAccess = !!subtaskForUser
        }

        // Anyone who can access the PARENT task can view its subtasks. This lets
        // the parent's owner/leader (its assignee) and team members open a member's
        // subtask — not only the subtask's own assignee.
        if (!hasAccess && task.parentId) {
          const parent = await prisma.task.findUnique({
            where: { id: task.parentId },
            select: {
              creatorId: true,
              assigneeId: true,
              teamMembers: { select: { userId: true } },
              collaborators: { select: { userId: true } },
            }
          })
          if (parent) {
            hasAccess =
              parent.creatorId === session.user.id ||
              parent.assigneeId === session.user.id ||
              parent.teamMembers.some(tm => tm.userId === session.user.id) ||
              parent.collaborators.some(c => c.userId === session.user.id)
          }
        }

        if (!hasAccess) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else {
        // For tasks with teams, check team membership
        const teamMember = await prisma.teamMember.findUnique({
          where: {
            userId_teamId: {
              userId: session.user.id,
              teamId: task.teamId
            }
          }
        })

        if (!teamMember) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
    }

    // Viewer's completion/status permissions, computed server-side so the client
    // never replicates permission logic. Flat assignee model.
    let viewerTeamRole: TeamMemberRole | undefined
    if (task.teamId) {
      const vm = await prisma.teamMember.findUnique({
        where: { userId_teamId: { userId: session.user.id, teamId: task.teamId } },
        select: { role: true },
      })
      viewerTeamRole = vm?.role
    }
    const isParentLeaderView = !!task.parent && (
      task.parent.creatorId === session.user.id ||
      task.parent.assigneeId === session.user.id
    )
    // Owner = board owner, or (for a board-less task) the creator.
    const isOwnerView = task.board
      ? task.board.ownerId === session.user.id
      : task.creatorId === session.user.id
    const viewerCanComplete = canFinalizeTask({
      isAdmin: session.user.role === 'ADMIN',
      isBoardLeader: session.user.role === 'LEADER' && isTeamLeader(viewerTeamRole),
      isOwner: isOwnerView,
      isParentLeader: isParentLeaderView,
    })
    // Only the task's assignee(s) count here — not team members/collaborators.
    const isAssigneeView =
      task.assigneeId === session.user.id ||
      task.assignees?.some(a => a.userId === session.user.id) ||
      false
    const viewerCanChangeStatus = viewerCanComplete || isAssigneeView
    // Rating is broader than completion: every LEADER in the board may rate.
    const viewerCanRate = await resolveCanRateWorkQuality({
      canFinalize: viewerCanComplete,
      isLeader: session.user.role === 'LEADER',
      userId: session.user.id,
      boardId: task.boardId,
      boardOwnerId: task.board?.ownerId ?? null,
      boardTeamId: task.board?.teamId ?? null,
      taskTeamId: task.teamId,
    })

    return NextResponse.json({ ...task, viewerCanComplete, viewerCanChangeStatus, viewerCanRate })
  } catch (error) {
    console.error('Task GET error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get existing task with all related data
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id },
      include: {
        team: true,
        teamMembers: true,
        collaborators: true,
        assignees: { select: { userId: true } },
        // Board owner gates who can move/finalize; teamId scopes board-rating.
        board: { select: { ownerId: true, teamId: true } },
        // Parent's leader/creator can finalize this subtask (review → done)
        parent: { select: { assigneeId: true, creatorId: true, boardId: true } },
      }
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Get user's team member info (only if task has a teamId)
    let teamMember = null
    if (existingTask.teamId) {
      teamMember = await prisma.teamMember.findUnique({
        where: {
          userId_teamId: {
            userId: session.user.id,
            teamId: existingTask.teamId
          }
        }
      })
    }

    const body = await req.json()
    const updateData = updateTaskSchema.parse(body)

    // Finishers (creator / assigner / board-leader / admin / parent-leader) can
    // mark the task COMPLETED. Flat assignee model: the assignees who do the work
    // submit for review (IN_REVIEW) but never self-complete. (taskType is no
    // longer part of this decision — the old "TEAM task lead assignee" path is
    // intentionally gone.)
    const isAdmin = session.user.role === 'ADMIN'
    const isLeader = session.user.role === 'LEADER'
    const isParentLeader = !!existingTask.parent && (
      existingTask.parent.assigneeId === session.user.id ||
      existingTask.parent.creatorId === session.user.id
    )
    const isBoardLeader = isLeader && isTeamLeader(teamMember?.role)
    // Owner = board owner, or (for a board-less task) the creator — so tasks
    // that were never on a board stay completable by their creator.
    const isOwner = existingTask.board
      ? existingTask.board.ownerId === session.user.id
      : existingTask.creatorId === session.user.id
    // Only the task's assignee(s) — not team members/collaborators — may move it.
    const isAssignee =
      existingTask.assigneeId === session.user.id ||
      existingTask.assignees?.some(a => a.userId === session.user.id) ||
      false
    let canComplete = canFinalizeTask({
      isAdmin,
      isBoardLeader,
      isOwner,
      isParentLeader,
    })
    const isAssigner = existingTask.assignedById === session.user.id
    const isCreator = existingTask.creatorId === session.user.id

    // Who may rate work quality: every LEADER in the task's board (not just the
    // board/task creator), plus the existing finishers. Broader than canComplete
    // — completion permission is unchanged. Board access is verified server-side.
    let canRate = await resolveCanRateWorkQuality({
      canFinalize: canComplete,
      isLeader,
      userId: session.user.id,
      boardId: existingTask.boardId,
      boardOwnerId: existingTask.board?.ownerId ?? null,
      boardTeamId: existingTask.board?.teamId ?? null,
      taskTeamId: existingTask.teamId,
    })

    // ── Board Reviewers enforcement ──
    // The board that governs review (a subtask inherits its parent's board). If
    // that board has a reviewer pool, only the task's assigned reviewer (or admin)
    // may finalize/rate — so nobody approves their own work.
    const reviewerBoardId = existingTask.boardId ?? existingTask.parent?.boardId ?? null
    const hasReviewerPool = reviewerBoardId
      ? (await prisma.boardReviewer.count({ where: { boardId: reviewerBoardId } })) > 0
      : false
    const assigneeIds = new Set<string>([
      ...(existingTask.assigneeId ? [existingTask.assigneeId] : []),
      ...(existingTask.assignees?.map(a => a.userId) ?? []),
    ])

    // Validate a reviewer assignment carried in this request. The submitter
    // (assignee) or a board leader/admin may set it; only to a pool member, and
    // never to the task's own assignee.
    if (updateData.reviewerId !== undefined) {
      const canAssignReviewer = isAssignee || isBoardLeader || isOwner || isAdmin
      if (!canAssignReviewer) {
        delete (updateData as any).reviewerId
      } else if (updateData.reviewerId) {
        if (!reviewerBoardId) {
          return NextResponse.json({ error: 'This task is not on a board with reviewers.' }, { status: 400 })
        }
        if (assigneeIds.has(updateData.reviewerId)) {
          return NextResponse.json({ error: "A task's assignee can't be its own reviewer." }, { status: 400 })
        }
        const inPool = await prisma.boardReviewer.findUnique({
          where: { boardId_userId: { boardId: reviewerBoardId, userId: updateData.reviewerId } },
          select: { id: true },
        })
        if (!inPool) {
          return NextResponse.json({ error: "Reviewer must be in the board's reviewer pool." }, { status: 400 })
        }
      }
    }

    const effectiveReviewerId =
      updateData.reviewerId !== undefined ? (updateData.reviewerId ?? null) : existingTask.reviewerId
    const reviewerGate = resolveReviewerGate({
      hasReviewerPool,
      reviewerId: effectiveReviewerId,
      viewerId: session.user.id,
      isAdmin,
      legacyCanFinalize: canComplete,
      legacyCanRate: canRate,
    })
    canComplete = reviewerGate.canFinalize
    canRate = reviewerGate.canRate

    // Leaders can extend due dates for tasks assigned to their team members (multi-leader support)
    let isLeaderSubordinateOverride = false
    if (isLeader && !isAssigner && !isCreator && !isAdmin && !isBoardLeader && !isOwner && !isParentLeader && existingTask.assigneeId) {
      const membership = await prisma.leaderMembership.findUnique({
        where: { leaderId_memberId: { leaderId: session.user.id, memberId: existingTask.assigneeId } }
      })
      if (membership) {
        isLeaderSubordinateOverride = true
      }
    }

    // Check dependency blocking: task cannot move to IN_PROGRESS if blocked
    if (updateData.status === 'IN_PROGRESS' && existingTask.status !== 'IN_PROGRESS') {
      const blockers = await prisma.taskDependency.findMany({
        where: { taskId: params.id },
        include: { dependsOn: { select: { id: true, title: true, status: true } } }
      })
      const unfinishedBlockers = blockers.filter(b => b.dependsOn.status !== 'COMPLETED')
      if (unfinishedBlockers.length > 0) {
        const titles = unfinishedBlockers.map(b => `"${b.dependsOn.title}"`).join(', ')
        return NextResponse.json({
          error: `This task is blocked by: ${titles}. Complete those tasks first.`
        }, { status: 400 })
      }
    }

    if (updateData.progressPercentage === 100 && !canComplete) {
      return NextResponse.json({
        error: 'Only the person who assigned this task can set progress to 100%.'
      }, { status: 403 })
    }

    // If trying to change status, enforce move permissions.
    if (updateData.status && updateData.status !== existingTask.status) {
      if (!session.user.role) {
        return NextResponse.json({ error: 'User role is required' }, { status: 403 })
      }

      // Finishers (admin / board leader / board owner / parent leader) can move
      // the task to any status, including COMPLETED. The assignee can move it
      // between non-completed statuses; everyone else is blocked.
      if (!canComplete && !canChangeTaskStatus({
        isAdmin,
        isAssignee,
        isBoardLeader,
        isOwner,
        targetStatus: updateData.status,
      })) {
        return NextResponse.json({
          error: 'You cannot change the status of this task. Please add a comment to communicate with the task owner.'
        }, { status: 403 })
      }
    }
    
    // For other edits, use general edit permissions
    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }
    
    // A board leader rating work quality (only workQuality/seniorWorkQuality in
    // the payload) is permitted even if they aren't a general editor/finisher of
    // this task. canRate already verified board access, so this isn't an open
    // door. Must come before the canEditTask gate, which rejects board leaders
    // who hold only a MEMBER role on the task's team.
    const requestedUpdateKeys = Object.keys(updateData).filter(
      k => updateData[k as keyof typeof updateData] !== undefined
    )
    const isRatingOnlyUpdate =
      requestedUpdateKeys.length > 0 &&
      requestedUpdateKeys.every(k => k === 'workQuality' || k === 'seniorWorkQuality')

    // Leader overriding due date of a subordinate's task: allow only dueDate change
    if (canRate && isRatingOnlyUpdate) {
      // Skip canEditTask — rating-only update by an authorized board rater.
    } else if (isLeaderSubordinateOverride) {
      const allowedKeys = new Set(['dueDate', 'startDate'])
      const requestedKeys = Object.keys(updateData).filter(k => updateData[k as keyof typeof updateData] !== undefined)
      const hasDisallowedFields = requestedKeys.some(k => !allowedKeys.has(k))
      if (hasDisallowedFields) {
        return NextResponse.json({ error: 'Leaders can only change the due date on subordinate tasks' }, { status: 403 })
      }
      // Skip canEditTask — dueDate-only override is permitted
    } else if (!canComplete && !canEditTask(
      session.user.role,
      existingTask.creatorId,
      [existingTask.assigneeId, ...(existingTask.assignees?.map(a => a.userId) || [])].filter((id): id is string => !!id),
      session.user.id,
      teamMember?.role
    )) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify assignee exists (if provided)
    if (updateData.assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: updateData.assigneeId }
      })

      if (!assignee) {
        return NextResponse.json(
          { error: 'Assignee not found' },
          { status: 400 }
        )
      }
    }

    // Auto-set startDate if not provided but dueDate is (for calendar display)
    const finalDueDate = updateData.dueDate ? new Date(updateData.dueDate) : undefined
    const finalStartDate = updateData.startDate
      ? new Date(updateData.startDate)
      : (finalDueDate ? new Date(finalDueDate) : (updateData.dueDate !== undefined ? existingTask.startDate : undefined))

    // Prevent non-assigner/creator from setting progress to 100% or status to COMPLETED
    // Only the person who assigned the task (or creator/admin) can complete it
    if (!canComplete) {
      // Cap progress at 90% (IN_REVIEW state)
      if (updateData.progressPercentage !== undefined && updateData.progressPercentage > 90) {
        updateData.progressPercentage = 90
      }
      // Prevent marking as COMPLETED
      if (updateData.status === 'COMPLETED') {
        return NextResponse.json({
          error: 'Only the person who assigned this task can mark it as completed. Please move it to "In Review" instead.'
        }, { status: 403 })
      }
    }

    // Auto-set status based on progress percentage
    let autoStatus: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'COMPLETED' | undefined
    if (updateData.progressPercentage !== undefined) {
      const progress = updateData.progressPercentage
      if (progress === 100 && canComplete) {
        autoStatus = 'COMPLETED'
      } else if (progress >= 90) {
        autoStatus = 'IN_REVIEW'
      } else if (progress > 0) {
        autoStatus = 'IN_PROGRESS'
      }
      // If progress is 0, don't auto-change status (let user keep it as TODO or whatever)
    }

    // Use auto-status if no explicit status was provided and we have an auto-status
    if (autoStatus && !updateData.status) {
      updateData.status = autoStatus
    }

    // Keep progress in sync when the status is set explicitly without a matching
    // progress — e.g. moving a card to Completed should read 100%, not its old
    // % (the "Completed task at 45%" bug). Mirrors the create-time derivation.
    if (updateData.status && updateData.progressPercentage === undefined) {
      if (updateData.status === 'COMPLETED') updateData.progressPercentage = 100
      else if (updateData.status === 'IN_REVIEW') updateData.progressPercentage = 90
      else if (updateData.status === 'TODO') updateData.progressPercentage = 0
    }

    // Keep the per-board custom status in sync with the category. If the client
    // supplied one (dragged into a specific board column), trust it. Otherwise,
    // when the status changes and the task is on a board, point it at that
    // board's default column for the new category so it lands correctly.
    if (
      updateData.customStatusId === undefined &&
      updateData.status &&
      updateData.status !== existingTask.status &&
      existingTask.boardId
    ) {
      const def = await prisma.boardStatus.findFirst({
        where: { boardId: existingTask.boardId, isDefault: true, category: updateData.status },
        select: { id: true },
      })
      if (def) (updateData as any).customStatusId = def.id
    }

    // Resolve workQuality permission: every board leader (canRate) may rate,
    // not just finishers. Board access was verified when computing canRate.
    if (updateData.workQuality !== undefined && !canRate) {
      delete (updateData as any).workQuality
    }
    // Senior override: any LEADER or ADMIN who is not the direct assigner
    if ((updateData as any).seniorWorkQuality !== undefined) {
      if (!isAdmin && !(isLeader && !isAssigner)) {
        delete (updateData as any).seniorWorkQuality
      }
    }

    // Work-quality gate: a task cannot be finalized as COMPLETED until its work
    // quality has been rated. "Rated" means either an existing non-NONE rating,
    // OR an explicit quality value picked in THIS request — including NONE (the
    // lowest grade, "1"), since choosing it is still a conscious rating. Only a
    // completion that carries no rating at all is blocked. Only canComplete users
    // reach here, so this enforces "consciously rate before approve/complete".
    const becomingCompleted =
      updateData.status === 'COMPLETED' && existingTask.status !== 'COMPLETED'
    if (becomingCompleted) {
      const hasExistingRating = [
        (existingTask as any).workQuality,
        (existingTask as any).seniorWorkQuality,
      ].some(r => r != null && r !== 'NONE')
      // A quality field present in updateData means the approver explicitly
      // picked a grade in this request (kept only when canRate — see above).
      const ratedThisRequest =
        (updateData as any).workQuality !== undefined ||
        (updateData as any).seniorWorkQuality !== undefined
      if (!hasExistingRating && !ratedThisRequest) {
        return NextResponse.json(
          { error: 'Please rate the work quality before completing this task.' },
          { status: 400 }
        )
      }
    }

    // Update task with transaction for related data
    const updatedTask = await prisma.$transaction(async (tx) => {
      // Prepare update data
      const taskUpdateData: any = {
        ...updateData,
        dueDate: finalDueDate,
        startDate: finalStartDate,
      }

      // Remove non-column fields from the task update data
      delete taskUpdateData.teamMemberIds
      delete taskUpdateData.collaboratorIds
      delete taskUpdateData.fieldValues

      // Dual-write: keep isCascading in sync with taskType when taskType is being updated
      if (updateData.taskType !== undefined) {
        taskUpdateData.isCascading = updateData.taskType === 'CASCADING'
      }

      // Set completion timestamps based on status transitions
      const newStatus = taskUpdateData.status
      if (newStatus === 'IN_REVIEW' && existingTask.status !== 'IN_REVIEW' && !existingTask.memberSubmittedAt) {
        taskUpdateData.memberSubmittedAt = new Date()
      }
      if (newStatus === 'COMPLETED' && existingTask.status !== 'COMPLETED' && canComplete) {
        taskUpdateData.leaderEvaluatedAt = new Date()
      }

      // Track senior evaluator
      if (taskUpdateData.seniorWorkQuality !== undefined && taskUpdateData.seniorWorkQuality !== null) {
        taskUpdateData.seniorEvaluatorId = session.user.id
        taskUpdateData.seniorEvaluatedAt = new Date()
      }

      // Update only this instance (next instances are spawned lazily on completion)
      await tx.task.update({
        where: { id: params.id },
        data: taskUpdateData,
      })

      // Upsert per-board custom field values when provided.
      if (updateData.fieldValues) {
        await setTaskFieldValues(tx, params.id, updateData.fieldValues)
      }

      // Update team members if taskType is TEAM and teamMemberIds provided
      if (updateData.taskType === 'TEAM' && updateData.teamMemberIds) {
        // Remove existing team members
        await tx.taskTeamMember.deleteMany({
          where: { taskId: params.id }
        })

        // Add new team members
        if (updateData.teamMemberIds.length > 0) {
          const teamMemberData = updateData.teamMemberIds.map(userId => ({
            taskId: params.id,
            userId,
            role: 'MEMBER' as const, // All are members, current user is the leader
          }))

          await tx.taskTeamMember.createMany({
            data: teamMemberData,
          })
        }
      }

      // Update collaborators if taskType is COLLABORATION and collaboratorIds provided
      if (updateData.taskType === 'COLLABORATION' && updateData.collaboratorIds) {
        // Remove existing collaborators
        await tx.taskCollaborator.deleteMany({
          where: { taskId: params.id }
        })

        // Add new collaborators
        if (updateData.collaboratorIds.length > 0) {
          const collaboratorData = updateData.collaboratorIds.map(userId => ({
            taskId: params.id,
            userId,
          }))

          await tx.taskCollaborator.createMany({
            data: collaboratorData,
          })
        }
      }

      // Dual-write: re-sync TaskAssignee flat list when assignee/team/collab data is in this request.
      // Mirror the exact same conditions the legacy taskTeamMember / taskCollaborator blocks use so
      // the flat list always matches what those tables end up as after this PATCH.
      const touchesAssignees =
        updateData.assigneeId !== undefined ||
        (updateData.taskType === 'TEAM' && updateData.teamMemberIds !== undefined) ||
        (updateData.taskType === 'COLLABORATION' && updateData.collaboratorIds !== undefined)
      if (touchesAssignees) {
        const effectiveAssigneeId =
          updateData.assigneeId !== undefined ? updateData.assigneeId : existingTask.assigneeId
        // Only use incoming teamMemberIds when the legacy block would have rewritten them
        const effectiveTeamMemberIds =
          updateData.taskType === 'TEAM' && updateData.teamMemberIds !== undefined
            ? updateData.teamMemberIds
            : existingTask.teamMembers.map((tm: { userId: string }) => tm.userId)
        // Only use incoming collaboratorIds when the legacy block would have rewritten them
        const effectiveCollaboratorIds =
          updateData.taskType === 'COLLABORATION' && updateData.collaboratorIds !== undefined
            ? updateData.collaboratorIds
            : existingTask.collaborators.map((c: { userId: string }) => c.userId)
        await setTaskAssignees(tx, params.id, [effectiveAssigneeId, ...effectiveTeamMemberIds, ...effectiveCollaboratorIds])
      }

      // Return updated task with all relations
      return await tx.task.findUnique({
        where: { id: params.id },
        include: {
          assignee: {
            select: { id: true, name: true, email: true, image: true }
          },
          creator: {
            select: { id: true, name: true, email: true, image: true }
          },
          assignedBy: {
            select: { id: true, name: true, email: true, image: true }
          },
          team: {
            select: { id: true, name: true }
          },
          teamMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true
                }
              }
            }
          },
          collaborators: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  image: true
                }
              }
            }
          }
        }
      })
    })

    // If this is a subtask and status changed, recalculate parent's progress
    let updatedParentTask = null
    if (existingTask.parentId && updateData.status) {
      // Get all subtasks of the parent
      const allSubtasks = await prisma.task.findMany({
        where: { parentId: existingTask.parentId },
        select: { status: true, cascadeOrder: true, isLocked: true }
      })

      // Calculate progress based on subtask statuses
      // COMPLETED = 100%, IN_REVIEW = 90%, IN_PROGRESS = 50%, TODO = 0%
      const statusWeights: Record<string, number> = {
        'COMPLETED': 100,
        'IN_REVIEW': 90,
        'IN_PROGRESS': 50,
        'TODO': 0
      }

      const totalProgress = allSubtasks.reduce((sum, st) => sum + (statusWeights[st.status] || 0), 0)
      const avgProgress = Math.round(totalProgress / allSubtasks.length)

      // When ALL subtasks are completed, push parent to IN_REVIEW at 90%
      // so a leader can verify before marking it fully complete.
      const allCompleted = allSubtasks.length > 0 && allSubtasks.every(st => st.status === 'COMPLETED')

      updatedParentTask = await prisma.task.update({
        where: { id: existingTask.parentId },
        data: {
          progressPercentage: allCompleted ? 90 : avgProgress,
          // Derive the parent's status from its subtasks (its progress is already
          // auto-calculated, so status should track too): all done -> IN_REVIEW,
          // any progress -> IN_PROGRESS, nothing started -> TODO.
          status: allCompleted ? 'IN_REVIEW' : avgProgress > 0 ? 'IN_PROGRESS' : 'TODO',
        },
        include: {
          assignee: { select: { id: true, name: true, email: true, image: true } },
          creator: { select: { id: true, name: true, email: true, image: true } },
          team: { select: { id: true, name: true } },
          subtasks: {
            include: {
              assignee: { select: { id: true, name: true, email: true, image: true } }
            },
            orderBy: [{ cascadeOrder: 'asc' }, { createdAt: 'asc' }]
          }
        }
      })
    }

    // --- Cascade unlock: when a cascade step completes, unlock the next step ---
    if (
      updateData.status === 'COMPLETED' &&
      existingTask.status !== 'COMPLETED' &&
      existingTask.cascadeOrder !== null &&
      existingTask.parentId
    ) {
      try {
        const nextStep = await prisma.task.findFirst({
          where: {
            parentId: existingTask.parentId,
            cascadeOrder: (existingTask.cascadeOrder ?? 0) + 1,
            isLocked: true,
          },
          select: { id: true, title: true, assigneeId: true }
        })

        if (nextStep) {
          await prisma.task.update({
            where: { id: nextStep.id },
            data: { isLocked: false }
          })

          // Notify the next step's assignee that their step is now unlocked
          if (nextStep.assigneeId && nextStep.assigneeId !== session.user.id) {
            try {
              const parentTask = await prisma.task.findUnique({
                where: { id: existingTask.parentId },
                select: { title: true }
              })
              const assignerName = session.user.name || session.user.email || 'Someone'
              await notifySubtaskAssigned(
                nextStep.assigneeId,
                nextStep.id,
                nextStep.title,
                parentTask?.title || 'Cascading Task',
                assignerName
              )
            } catch (notifErr) {
              console.error('Error notifying cascade step unlock:', notifErr)
            }
          }
        }
      } catch (cascadeErr) {
        console.error('Error unlocking next cascade step:', cascadeErr)
      }
    }

    // --- Cascade cancel: when a cascade step is cancelled, cancel all subsequent locked steps ---
    if (
      updateData.status === 'CANCELLED' &&
      existingTask.cascadeOrder !== null &&
      existingTask.parentId
    ) {
      try {
        await prisma.task.updateMany({
          where: {
            parentId: existingTask.parentId,
            cascadeOrder: { gt: existingTask.cascadeOrder ?? 0 },
            isLocked: true,
          },
          data: { status: 'CANCELLED' }
        })
      } catch (cascadeErr) {
        console.error('Error cancelling subsequent cascade steps:', cascadeErr)
      }
    }
    // --- End cascade unlock ---

    // Send notifications for relevant changes
    if (updatedTask) {
      try {
        const assignerName = session.user.name || session.user.email || 'Someone'

        // Notify new assignee if task was reassigned to a different user
        if (
          updateData.assigneeId &&
          updateData.assigneeId !== existingTask.assigneeId &&
          updateData.assigneeId !== session.user.id
        ) {
          await notifyTaskAssigned(
            updateData.assigneeId,
            updatedTask.id,
            updatedTask.title,
            assignerName
          )
        }

        // Notify assignee when task is completed (if completer is not the assignee)
        if (
          updateData.status === 'COMPLETED' &&
          existingTask.status !== 'COMPLETED' &&
          existingTask.assigneeId &&
          existingTask.assigneeId !== session.user.id
        ) {
          await notifyTaskCompleted(
            existingTask.assigneeId,
            updatedTask.id,
            updatedTask.title,
            assignerName
          )
        }

        // Notify the reviewer (assignedBy or creator) when a task moves into
        // IN_REVIEW so Leaders aren't blind to work waiting on their approval.
        if (
          updateData.status === 'IN_REVIEW' &&
          existingTask.status !== 'IN_REVIEW'
        ) {
          const reviewerId = existingTask.assignedById ?? existingTask.creatorId
          if (reviewerId && reviewerId !== session.user.id) {
            await notifyTaskSubmittedForReview(
              reviewerId,
              updatedTask.id,
              updatedTask.title,
              assignerName
            )
          }
        }

        // Notify assignee of other updates (status/priority changes) if they didn't make the change
        if (
          !updateData.assigneeId &&
          updateData.status !== 'COMPLETED' &&
          (updateData.status || updateData.priority) &&
          existingTask.assigneeId &&
          existingTask.assigneeId !== session.user.id
        ) {
          const changeType = updateData.status
            ? `changed status to ${updateData.status}`
            : `changed priority to ${updateData.priority}`
          await notifyTaskUpdated(
            existingTask.assigneeId,
            updatedTask.id,
            updatedTask.title,
            assignerName,
            changeType
          )
        }
      } catch (notificationError) {
        console.error('Error sending task update notification:', notificationError)
      }
    }

    // Log activity
    if (updatedTask) {
      await prisma.activity.create({
        data: {
          type: 'TASK_UPDATED',
          description: `Updated task: ${updatedTask.title}`,
          userId: session.user.id,
          entityId: updatedTask.id,
          entityType: 'task',
          metadata: updateData,
        }
      })

      // Auto-sync to Google Calendar if enabled
      await autoSyncTask(updatedTask.id, session.user.id)

      // Send notifications for newly added users
      const assignerName = session.user.name || session.user.email || 'Someone'
      const existingUserIds = new Set<string>()

      // Collect existing users before update
      if (existingTask.assigneeId) existingUserIds.add(existingTask.assigneeId)

      // Check if assignee changed
      if (updateData.assigneeId &&
          updateData.assigneeId !== existingTask.assigneeId &&
          updateData.assigneeId !== session.user.id) {
        try {
          await notifyTaskAssigned(updateData.assigneeId, updatedTask.id, updatedTask.title, assignerName)
          console.log('Sent reassignment notification to:', updateData.assigneeId)
        } catch (err) {
          console.error('Failed to send reassignment notification:', err)
        }
      }

      // Notify new team members
      if (updateData.teamMemberIds && updateData.teamMemberIds.length > 0) {
        for (const userId of updateData.teamMemberIds) {
          if (!existingUserIds.has(userId) && userId !== session.user.id) {
            try {
              await notifyTaskAssigned(userId, updatedTask.id, updatedTask.title, assignerName)
              console.log('Sent team member notification to:', userId)
            } catch (err) {
              console.error('Failed to send team member notification:', err)
            }
          }
        }
      }

      // Notify new collaborators
      if (updateData.collaboratorIds && updateData.collaboratorIds.length > 0) {
        for (const userId of updateData.collaboratorIds) {
          if (!existingUserIds.has(userId) && userId !== session.user.id) {
            try {
              await notifyTaskAssigned(userId, updatedTask.id, updatedTask.title, assignerName)
              console.log('Sent collaborator notification to:', userId)
            } catch (err) {
              console.error('Failed to send collaborator notification:', err)
            }
          }
        }
      }
    }

    // --- Recurring chain: spawn next instance when this one is COMPLETED ---
    let nextRecurringInstance = null

    const isNowCompleted =
      updateData.status === 'COMPLETED' &&
      existingTask.status !== 'COMPLETED' &&
      existingTask.recurringParentId !== null

    if (isNowCompleted && updatedTask) {
      try {
        const template = await prisma.task.findUnique({
          where: { id: existingTask.recurringParentId! },
          include: { teamMembers: true, collaborators: true }
        })

        if (
          template?.recurringFrequency &&
          template?.startDate &&
          existingTask.dueDate
        ) {
          const nextDate = getNextOccurrenceDate(
            template.startDate,
            template.recurringEndDate ?? null,   // null = indefinite
            template.recurringFrequency,
            template.recurringInterval ?? 1,
            template.recurringDaysOfWeek ?? [],
            existingTask.dueDate
          )

          // Accept next date if series is indefinite OR if within the end date
          if (nextDate && (!template.recurringEndDate || nextDate <= template.recurringEndDate)) {
            // Idempotency guard: skip if this occurrence already exists
            const nextMidnight = new Date(nextDate)
            nextMidnight.setHours(0, 0, 0, 0)
            const alreadyExists = await prisma.task.findFirst({
              where: {
                recurringParentId: template.id,
                dueDate: {
                  gte: nextMidnight,
                  lt: new Date(nextMidnight.getTime() + 24 * 60 * 60 * 1000),
                }
              }
            })

            if (!alreadyExists) {
              nextRecurringInstance = await prisma.$transaction(async (tx2) => {
                const newInst = await tx2.task.create({
                  data: {
                    title: template.title,
                    description: template.description,
                    priority: template.priority,
                    status: 'TODO',
                    progressPercentage: 0,
                    taskType: template.taskType,
                    dueDate: nextDate,
                    startDate: nextDate,
                    assigneeId: template.assigneeId,
                    creatorId: template.creatorId,
                    teamId: null,
                    assignedById: template.assignedById,
                    location: template.location,
                    meetingLink: template.meetingLink,
                    allDay: template.allDay,
                    recurrence: template.recurrence,
                    isRecurring: false,
                    recurringParentId: template.id,
                  }
                })
                if (template.taskType === 'TEAM' && template.teamMembers.length > 0) {
                  await tx2.taskTeamMember.createMany({
                    data: template.teamMembers.map(tm => ({ taskId: newInst.id, userId: tm.userId, role: 'MEMBER' as const }))
                  })
                }
                if (template.taskType === 'COLLABORATION' && template.collaborators.length > 0) {
                  await tx2.taskCollaborator.createMany({
                    data: template.collaborators.map(c => ({ taskId: newInst.id, userId: c.userId }))
                  })
                }
                // Copy subtasks from the completing instance so they recur too
                const sourceSubtasks = await tx2.task.findMany({
                  where: { parentId: existingTask.id },
                  select: {
                    title: true, description: true, priority: true, taskType: true,
                    assigneeId: true, creatorId: true, assignedById: true,
                  }
                })
                if (sourceSubtasks.length > 0) {
                  await tx2.task.createMany({
                    data: sourceSubtasks.map(st => ({
                      title: st.title,
                      description: st.description ?? null,
                      priority: st.priority,
                      status: 'TODO' as const,
                      progressPercentage: 0,
                      taskType: st.taskType,
                      assigneeId: st.assigneeId,
                      creatorId: st.creatorId,
                      assignedById: st.assignedById,
                      dueDate: nextDate,
                      startDate: nextDate,
                      parentId: newInst.id,
                      isRecurring: false,
                    }))
                  })
                }
                return newInst
              })

              // Notify assignee about the new instance
              if (nextRecurringInstance.assigneeId && nextRecurringInstance.assigneeId !== session.user.id) {
                const assignerName = session.user.name || session.user.email || 'System'
                await notifyTaskAssigned(
                  nextRecurringInstance.assigneeId,
                  nextRecurringInstance.id,
                  nextRecurringInstance.title,
                  assignerName
                )
              }
            }
          }
        }
      } catch (chainError) {
        console.error('Error spawning next recurring instance:', chainError)
        // Non-fatal: COMPLETED status on current task is already saved
      }
    }
    // --- End recurring chain ---

    // Return both the updated task and parent task if applicable
    return NextResponse.json({
      ...updatedTask,
      updatedParentTask,
      nextRecurringInstance
    })
  } catch (error) {
    console.error('Task update error:', error)
    
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check for series deletion scope
    const { searchParams } = new URL(req.url)
    const scope = searchParams.get('scope')

    // Get existing task
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        creatorId: true,
        teamId: true,
        recurringParentId: true,
        parentId: true,
        assignedById: true,
      }
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Get user's team member info (only if task has a teamId)
    let teamMember = null
    if (existingTask.teamId) {
      teamMember = await prisma.teamMember.findUnique({
        where: {
          userId_teamId: {
            userId: session.user.id,
            teamId: existingTask.teamId
          }
        }
      })
    }

    // Check permissions
    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }
    
    // Direct permission on this task. NOTE: the args are (role, creatorId, userId,
    // assignedById, teamMemberRole) — previously teamMember.role was mistakenly
    // passed into the assignedById slot, so the leader branches never fired.
    let canDelete = canDeleteTask(
      session.user.role,
      existingTask.creatorId,
      session.user.id,
      existingTask.assignedById ?? undefined,
      teamMember?.role
    )

    // For a subtask, anyone who could delete/manage its PARENT task may delete it
    // too (a parent's creator / assigning leader / team leader / admin). This is
    // what lets a leader clean up subtasks under a task they own.
    if (!canDelete && existingTask.parentId) {
      const parent = await prisma.task.findUnique({
        where: { id: existingTask.parentId },
        select: { creatorId: true, assignedById: true, teamId: true },
      })
      if (parent) {
        const parentTeamMember = parent.teamId
          ? await prisma.teamMember.findUnique({
              where: { userId_teamId: { userId: session.user.id, teamId: parent.teamId } },
            })
          : null
        canDelete = canDeleteTask(
          session.user.role,
          parent.creatorId,
          session.user.id,
          parent.assignedById ?? undefined,
          parentTeamMember?.role
        )
      }
    }

    if (!canDelete) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Handle series deletion
    if (scope === 'series' && existingTask.recurringParentId) {
      const parentId = existingTask.recurringParentId
      // Find all instances in the series
      const seriesInstances = await prisma.task.findMany({
        where: { recurringParentId: parentId },
        select: { id: true }
      })
      const instanceIds = seriesInstances.map(t => t.id)
      // Delete subtasks of all instances first
      if (instanceIds.length > 0) {
        await prisma.task.deleteMany({ where: { parentId: { in: instanceIds } } })
      }
      // Delete all instances
      await prisma.task.deleteMany({ where: { recurringParentId: parentId } })
      // Delete the template task
      await prisma.task.delete({ where: { id: parentId } })

      await prisma.activity.create({
        data: {
          type: 'TASK_UPDATED',
          description: `Deleted recurring series: ${existingTask.title}`,
          userId: session.user.id,
          entityId: parentId,
          entityType: 'task',
        }
      })
      return NextResponse.json({ message: 'Recurring series deleted successfully' })
    }

    // Get task details before deletion to find associated Event records
    const taskToDelete = await prisma.task.findUnique({
      where: { id: params.id },
      select: {
        googleCalendarEventId: true,
        title: true
      }
    })

    // Delete from Google Calendar if synced
    await deleteSyncedTask(params.id, session.user.id)

    // Delete any Event records that were created from this task's Google Calendar event
    if (taskToDelete?.googleCalendarEventId) {
      await prisma.event.deleteMany({
        where: {
          OR: [
            { googleCalendarEventId: taskToDelete.googleCalendarEventId },
            { title: `[Task] ${taskToDelete.title}` }
          ],
          creatorId: session.user.id
        }
      })
      console.log(`Deleted Event records for task ${params.id}`)
    }

    // Explicitly delete subtasks before deleting the parent
    // (self-referential cascade on the same table can be unreliable)
    await prisma.task.deleteMany({ where: { parentId: params.id } })

    // Delete task (cascade will handle comments and task-specific relations)
    await prisma.task.delete({
      where: { id: params.id }
    })

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'TASK_UPDATED',
        description: `Deleted task: ${existingTask.title}`,
        userId: session.user.id,
        entityId: existingTask.id,
        entityType: 'task',
      }
    })

    // Emit WebSocket event to trigger calendar refresh
    if (global.io) {
      global.io.to(`user-${session.user.id}`).emit('task-deleted', {
        taskId: params.id,
        timestamp: new Date().toISOString()
      })
      console.log(`Emitted task-deleted event for user ${session.user.id}`)
    }

    return NextResponse.json({ message: 'Task deleted successfully' })
  } catch (error) {
    console.error('Task deletion error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}