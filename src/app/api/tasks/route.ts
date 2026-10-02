import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hasPermission, canFinalizeTask } from '@/lib/permissions'
import { leaderBoardIds } from '@/lib/board-access'
import { ticketSearchConditions } from '@/lib/task-search'
import { PERMISSIONS } from '@/constants'
import { autoSyncTask } from '@/lib/calendar-sync-helper'
import { notifyTaskAssigned, notifySubtaskAssigned } from '@/lib/notifications'
import { generateOccurrenceDates, buildRRuleString } from '@/lib/recurring'
import { resolveTeamBoardLink } from '@/lib/team-board'
import { setTaskAssignees } from '@/lib/task-assignees'
import { setTaskFieldValues } from '@/lib/task-fields'
import { taskInvolvementOr } from '@/lib/task-scope'
import { broadcastTaskChange } from '@/lib/task-events'
import { allocateTicketNumber, applyManualTicketNumber, TicketNumberError } from '@/lib/ticket-allocate'
import { resolveRoleAddressing } from '@/lib/board-roles'
import { maybeArchiveStaleCompletedTasks } from '@/lib/auto-archive'

const cascadeStepSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  assigneeId: z.string().optional().nullable(),
  // A step can be addressed to a board role instead of a person (field report
  // 2026-09). Same addressing rule as the task itself.
  assignedRoleId: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
})

/** A role that cannot receive the task — surfaced to the user, not a 500. */
class RoleAddressingError extends Error {}

const createTaskSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  dueDate: z.string().datetime().optional(),
  startDate: z.string().datetime().optional(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  taskType: z.enum(['INDIVIDUAL', 'TEAM', 'COLLABORATION', 'CASCADING']),
  // Cascading task steps
  cascadeSteps: z.array(cascadeStepSchema).optional().default([]),
  assigneeId: z.string().nullish(), // Always current user
  teamMemberIds: z.array(z.string()).default([]),
  collaboratorIds: z.array(z.string()).default([]),
  assignedById: z.string().optional(),
  // Subtask support
  parentId: z.string().optional(),
  // New Google Calendar-compatible fields
  location: z.string().optional(),
  meetingLink: z.string().url().optional().or(z.literal('')),
  allDay: z.boolean().optional(),
  recurrence: z.string().optional(),
  // Recurring task fields
  isRecurring: z.boolean().optional().default(false),
  recurringFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).optional(),
  recurringInterval: z.number().int().min(1).max(30).optional(),
  recurringDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  recurringEndDate: z.string().datetime().optional().nullable(), // null = indefinite series
  // Task gravity / SLA / reminders
  taskWeight: z.number().int().min(1).max(5).optional(),
  slaHours: z.number().int().min(1).optional().nullable(),
  reminderDays: z.array(z.number().int().min(1)).optional().default([]),
  // Optional manual ticket number ("OPS-14"). Omitted => allocated automatically.
  ticketNumber: z.string().trim().max(24).optional().nullable(),
  // Address the task to a board role instead of naming a person.
  assignedRoleId: z.string().optional().nullable(),
  // Kanban board
  boardId: z.string().optional().nullable(),
  // Per-board custom status column to drop the new task into (#26)
  customStatusId: z.string().optional().nullable(),
  // Per-board custom field values
  fieldValues: z.array(z.object({ fieldId: z.string(), value: z.string().nullable() })).optional(),
  // File attachments (uploaded to OSS via /api/upload/task-file before submit)
  attachments: z.array(z.object({
    fileUrl: z.string().url(),
    fileName: z.string().min(1).max(255),
    fileType: z.string().optional().nullable(),
    fileSize: z.number().int().nonnegative().optional().nullable(),
  })).max(20, 'Cannot attach more than 20 files').optional().default([]),
})

const querySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('10'),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
  search: z.string().optional(),
  userId: z.string().optional(), // Filter by user involved in task
  excludeCreator: z.string().optional(), // Exclude tasks created by this user
  parentId: z.string().optional(), // Filter subtasks by parent task
  includeSubtasks: z.string().optional(), // Include subtasks in results (default: false)
  boardId: z.string().optional(), // Filter by board ('none' = unassigned)
  includeManagedMembers: z.string().optional(), // Leader: also include tasks assigned to managed members (Member Management aggregate)
  dueDateFrom: z.string().optional(), // YYYY-MM-DD inclusive lower bound on dueDate
  dueDateTo: z.string().optional(),   // YYYY-MM-DD inclusive upper bound on dueDate
})

export async function GET(req: NextRequest) {
  try {
    const session = await getRequestSession(req)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permissions
    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }
    
    // Completed → Backlog after 5 days. Throttled and fire-and-forget.
    maybeArchiveStaleCompletedTasks()

    if (!hasPermission(session.user.role, PERMISSIONS.RESOURCES.TASK, 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const {
      page,
      limit,
      status,
      priority,
      assigneeId,
      teamId,
      search,
      userId,
      excludeCreator,
      parentId,
      includeSubtasks,
      boardId,
      includeManagedMembers,
      dueDateFrom,
      dueDateTo,
    } = querySchema.parse(Object.fromEntries(searchParams))

    const pageNum = parseInt(page)
    // Cap raised to 1000 so the Kanban board can request many tasks at once
    // (board fetches 50 × pages-loaded for its "Load more"). Default stays 10.
    const limitNum = Math.min(parseInt(limit), 1000)
    const skip = (pageNum - 1) * limitNum

    // A leader explicitly viewing one of their managed members' tasks (e.g. the
    // Member Management panel, which requests ?assigneeId=<member>) should see
    // ALL of that member's tasks — not only the ones the leader personally
    // participates in. This is scoped to a confirmed leader↔member relationship
    // so it does not widen what the leader sees on their own task board.
    let leaderViewingManagedMember = false
    if (assigneeId && session.user.role === 'LEADER' && assigneeId !== session.user.id) {
      const membership = await prisma.leaderMembership.findUnique({
        where: { leaderId_memberId: { leaderId: session.user.id, memberId: assigneeId } },
        select: { memberId: true },
      })
      leaderViewingManagedMember = !!membership
    }

    // Build where clause based on user role
    let where: any = {
      // Always hide template (parent) recurring tasks from the board
      isRecurring: false,
    }

    // Handle subtask filtering
    // Note: We handle this differently for non-admins below to include assigned subtasks
    if (parentId) {
      // Get subtasks of a specific parent
      where.parentId = parentId
    }

    // Admin can see all tasks, others see tasks they're involved in
    if (session.user.role !== 'ADMIN') {
      // Enforce top-level only at the where level to prevent subtasks from leaking through OR
      if (includeSubtasks !== 'true' && !parentId) {
        where.parentId = null
      }

      if (leaderViewingManagedMember) {
        // Leader is explicitly viewing a managed member's tasks: do not apply the
        // "involved in" restriction. The assigneeId filter applied below scopes
        // results to that member, so this returns all of the member's tasks.
      } else {
        // Get user's teams
        const userTeams = await prisma.teamMember.findMany({
          where: { userId: session.user.id },
          select: { teamId: true }
        })

        // Include tasks where user is:
        // 1. Part of a team (teamId in userTeams)
        // 2. Assignee (individual/collaboration tasks)
        // 3. Creator of the task
        // 4. Team member or collaborator
        const teamIds = userTeams.map(tm => tm.teamId)

        // When a leader requests their team aggregate (Member Management's
        // "All Team Tasks" view passes includeManagedMembers=true), also surface
        // tasks assigned to any managed member — including ones the member
        // created themselves. Gated by the explicit param so the leader's own
        // task board (which omits it) is unaffected.
        let managedMemberClause: any[] = []
        if (includeManagedMembers === 'true' && session.user.role === 'LEADER') {
          const memberships = await prisma.leaderMembership.findMany({
            where: { leaderId: session.user.id },
            select: { memberId: true },
          })
          const managedMemberIds = memberships.map(m => m.memberId)
          if (managedMemberIds.length > 0) {
            managedMemberClause = [{ assigneeId: { in: managedMemberIds } }]
          }
        }

        // For non-admins, show:
        // 1. Top-level tasks they're involved in (parentId = null)
        // 2. Parent tasks that have a subtask assigned to this user
        //    (subtasks are shown inline on the parent card, never as standalone cards)
        // Only include team tasks if a specific board or team filter is active.
        // For the 'All Tasks' view (where boardId and teamId are absent), we show only tasks the user is personally related to.
        const showTeamTasks = (boardId && boardId !== 'none') || !!teamId

        // Shared with the dashboard summary via taskInvolvementOr so the two
        // can't drift: [0] is the direct-involvement clause, [1] is the
        // "parent of a subtask assigned to me" branch (isLocked: false keeps
        // locked cascade steps from revealing their parent prematurely).
        const [involvementCore, subtaskBranch] = taskInvolvementOr(session.user.id)

        where.OR = [
          // Top-level tasks where user is involved
          {
            OR: [
              ...(showTeamTasks && teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
              ...managedMemberClause,
              involvementCore,
            ]
          },
          subtaskBranch,
        ]
      }
    } else {
      // For admins: by default only show top-level tasks unless includeSubtasks is true
      if (includeSubtasks !== 'true' && !parentId) {
        where.parentId = null
      }
    }

    // Apply filters
    if (status) {
      // Handle comma-separated status values
      const statusValues = status.split(',').map(s => s.trim())
      if (statusValues.length === 1) {
        where.status = statusValues[0]
      } else {
        where.status = { in: statusValues }
      }
    }
    if (priority) where.priority = priority
    if (assigneeId) where.assigneeId = assigneeId
    if (teamId) where.teamId = teamId
    if (excludeCreator) {
      where.NOT = { creatorId: excludeCreator }
    }

    // Board filter
    if (boardId === 'none') {
      where.boardId = null
    } else if (boardId) {
      where.boardId = boardId
    }

    // Due-date range filter (inclusive). The 'to' bound extends to end-of-day so
    // the whole selected day is included. Once a range is set, tasks without a
    // dueDate are naturally excluded.
    if (dueDateFrom || dueDateTo) {
      const dueRange: { gte?: Date; lte?: Date } = {}
      if (dueDateFrom) {
        const from = new Date(`${dueDateFrom}T00:00:00`)
        if (!isNaN(from.getTime())) dueRange.gte = from
      }
      if (dueDateTo) {
        const to = new Date(`${dueDateTo}T23:59:59.999`)
        if (!isNaN(to.getTime())) dueRange.lte = to
      }
      if (dueRange.gte || dueRange.lte) where.dueDate = dueRange
    }

    // Filter by specific user involvement
    if (userId) {
      const userFilterConditions = [
        { assigneeId: userId },
        { creatorId: userId },
        { assignedById: userId },
        {
          teamMembers: {
            some: { userId: userId }
          }
        },
        {
          collaborators: {
            some: { userId: userId }
          }
        }
      ]

      // Merge with existing OR conditions if any
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: userFilterConditions }
        ]
        delete where.OR
      } else {
        where.OR = userFilterConditions
      }
    }
    
    // Handle search - merge with existing OR conditions
    if (search) {
      const searchConditions = [
        // Ticket number first: "OPS-14", "ops14", "#14" or "14" — same rule as
        // the board's local filter (src/lib/task-search.ts).
        ...ticketSearchConditions(search),
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        // Search in user names (assignee, creator, team members, collaborators)
        {
          assignee: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } }
            ]
          }
        },
        {
          creator: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } }
            ]
          }
        },
        {
          teamMembers: {
            some: {
              user: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } }
                ]
              }
            }
          }
        },
        {
          collaborators: {
            some: {
              user: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } }
                ]
              }
            }
          }
        }
      ]

      // Handle multiple AND conditions
      if (where.AND) {
        where.AND.push({ OR: searchConditions })
      } else if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions }
        ]
        delete where.OR
      } else {
        where.OR = searchConditions
      }
    }

    // Get tasks with relations
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: {
          // Needed for the "Unclaimed · QA" chip on the card.
          assignedRole: { select: { id: true, name: true, color: true } },
          assignee: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          creator: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          assignedBy: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          team: {
            select: { id: true, name: true }
          },
          teamMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
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
                  firstName: true,
                  lastName: true,
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
                  firstName: true,
                  lastName: true,
                  name: true,
                  email: true,
                  image: true
                }
              }
            }
          },
          board: { select: { ownerId: true, teamId: true } },
          fieldValues: {
            include: { field: { select: { id: true, name: true, type: true, options: true, position: true } } },
          },
          _count: {
            select: { comments: true, subtasks: true }
          },
          subtasks: {
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              progressPercentage: true,
              dueDate: true,
              cascadeOrder: true,
              isLocked: true,
              assignee: {
                select: { id: true, name: true, email: true, image: true }
              },
              subtasks: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  cascadeOrder: true,
                  isLocked: true,
                  assignee: {
                    select: { id: true, name: true, email: true }
                  },
                  subtasks: {
                    select: {
                      id: true,
                      title: true,
                      status: true,
                      cascadeOrder: true,
                      isLocked: true,
                      assignee: {
                        select: { id: true, name: true, email: true }
                      }
                    },
                    orderBy: { cascadeOrder: 'asc' }
                  }
                },
                orderBy: { cascadeOrder: 'asc' }
              }
            },
            orderBy: [{ cascadeOrder: 'asc' }, { createdAt: 'asc' }]
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.task.count({ where })
    ])

    // Attach the viewer's completion/status permissions to each task so the
    // client renders the right controls without replicating permission logic.
    // Flat assignee model. isParentLeader is resolved by GET /api/tasks/[id];
    // the list is top-level tasks, so it stays false here.
    const leaderTeams = await prisma.teamMember.findMany({
      where: { userId: session.user.id, role: 'LEADER' },
      select: { teamId: true },
    })
    const leaderTeamIds = new Set(leaderTeams.map(t => t.teamId))
    // Every LEADER working in a board leads its tasks, whatever their team role
    // and even on old tasks with teamId = null (field reports 2026-09).
    const ledBoardIds = await leaderBoardIds(prisma, session.user.id, session.user.role)
    const viewerRole = session.user.role
    const tasksWithPerms = tasks.map((t: any) => {
      // Owner = board owner, or (for a board-less task) the creator.
      const isOwner = t.board ? t.board.ownerId === session.user.id : t.creatorId === session.user.id
      const viewerCanComplete = canFinalizeTask({
        isAdmin: viewerRole === 'ADMIN',
        // A LEADER of the board's team leads its tasks whatever their account
        // role — the same rule board roles already apply in GET/PATCH.
        isBoardLeader:
          (!!t.board?.teamId && leaderTeamIds.has(t.board.teamId)) ||
          (viewerRole === 'LEADER' && !!t.teamId && leaderTeamIds.has(t.teamId)) ||
          (!!t.boardId && ledBoardIds.has(t.boardId)),
        isOwner,
        isParentLeader: false,
      })
      // Only the task's assignee(s) — not team members/collaborators.
      const isAssignee =
        t.assigneeId === session.user.id ||
        t.assignees?.some((a: any) => a.userId === session.user.id) ||
        false
      return { ...t, viewerCanComplete, viewerCanChangeStatus: viewerCanComplete || isAssignee }
    })

    return NextResponse.json({
      tasks: tasksWithPerms,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('Tasks GET error:', error)
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

    // Check permissions
    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }
    
    if (!hasPermission(session.user.role, PERMISSIONS.RESOURCES.TASK, 'create')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const {
      title,
      description,
      priority,
      dueDate,
      startDate,
      status,
      progressPercentage,
      taskType,
      assigneeId,
      teamMemberIds,
      collaboratorIds,
      assignedById,
      parentId,
      cascadeSteps,
      // New Google Calendar fields
      location,
      meetingLink,
      allDay,
      recurrence,
      // Recurring task fields
      isRecurring,
      recurringFrequency,
      recurringInterval,
      recurringDaysOfWeek,
      recurringEndDate,
      // New fields
      taskWeight,
      slaHours,
      reminderDays,
      boardId,
      customStatusId,
      fieldValues,
      attachments,
      ticketNumber: manualTicketNumber,
      assignedRoleId,
    } = createTaskSchema.parse(body)

    // Normalize attachment rows once; reused by whichever creation path runs.
    const attachmentRows = (attachments ?? []).map((a) => ({
      fileUrl: a.fileUrl,
      fileName: a.fileName,
      fileType: a.fileType ?? null,
      fileSize: a.fileSize ?? null,
      uploadedById: session.user.id,
    }))

    // Verify assignee exists (if provided)
    if (assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assigneeId }
      })

      if (!assignee) {
        return NextResponse.json(
          { error: 'Assignee not found' },
          { status: 400 }
        )
      }
    }

    // If this task targets a team board, derive its teamId from the board so
    // team-scoped queries work. boardId is canonical (sent by the board switcher);
    // personal boards / no board yield teamId = null. Additive: teamId was always null here.
    const link = await resolveTeamBoardLink({ boardId: boardId ?? null })

    // Authorization: if the task targets a team board, the creator must be a member of
    // that team (any role). Admins bypass. Prevents planting tasks on teams you're not in.
    if (link.teamId && session.user.role !== 'ADMIN') {
      const membership = await prisma.teamMember.findFirst({
        where: { teamId: link.teamId, userId: session.user.id },
        select: { id: true },
      })
      if (!membership) {
        return NextResponse.json(
          { error: 'You are not a member of this team' },
          { status: 403 }
        )
      }
    }

    // Auto-set startDate if not provided but dueDate is (for calendar display)
    const finalDueDate = dueDate ? new Date(dueDate) : null
    const finalStartDate = startDate
      ? new Date(startDate)
      : (finalDueDate ? new Date(finalDueDate) : null) // Auto-set to dueDate if not provided

    // Auto-set status based on progress percentage
    let finalStatus = status
    if (progressPercentage !== undefined && !status) {
      if (progressPercentage === 100) {
        finalStatus = 'COMPLETED'
      } else if (progressPercentage > 90) {
        finalStatus = 'IN_REVIEW'
      } else if (progressPercentage > 0) {
        finalStatus = 'IN_PROGRESS'
      }
    }

    // Conversely, derive progress from the chosen status so a task created
    // directly in a later column reads that column's progress (In Review = 90%,
    // Completed = 100%) instead of 0%. Mirrors the status⟷progress contract
    // enforced on updates (PATCH caps In Review at 90).
    let finalProgress = progressPercentage ?? 0
    if (finalStatus === 'IN_REVIEW') finalProgress = 90
    else if (finalStatus === 'COMPLETED') finalProgress = 100
    else if (finalStatus === 'TODO' || finalStatus === 'BACKLOG') finalProgress = 0

    // Handle recurring task creation
    if (isRecurring && recurringFrequency && finalStartDate) {
      const endDate = recurringEndDate ? new Date(recurringEndDate) : null
      const rruleString = buildRRuleString(
        recurringFrequency,
        recurringInterval || 1,
        recurringDaysOfWeek || [],
        endDate
      )
      const occurrences = generateOccurrenceDates(
        finalStartDate,
        endDate,
        recurringFrequency,
        recurringInterval || 1,
        recurringDaysOfWeek || []
      )

      const { template, firstInstance, totalOccurrences } = await prisma.$transaction(async (tx) => {
        // Create the hidden template task
        const templateTask = await tx.task.create({
          data: {
            title,
            description,
            priority,
            status: 'TODO',
            progressPercentage: 0,
            taskType,
            isCascading: taskType === 'CASCADING',
            dueDate: finalDueDate,
            startDate: finalStartDate,
            assigneeId: assigneeId || session.user.id,
            creatorId: session.user.id,
            teamId: null,
            assignedById: assignedById || session.user.id,
            location: location || null,
            meetingLink: meetingLink || null,
            allDay: allDay !== undefined ? allDay : false,
            recurrence: rruleString,
            isRecurring: true,
            recurringFrequency,
            recurringInterval: recurringInterval || 1,
            recurringDaysOfWeek: recurringDaysOfWeek || [],
            recurringEndDate: endDate,
            taskWeight: taskWeight || null,
            slaHours: slaHours || null,
            reminderDays: reminderDays || [],
          },
        })
        await setTaskAssignees(tx, templateTask.id, [assigneeId || session.user.id, ...teamMemberIds, ...collaboratorIds])

        // Only create the first instance; subsequent instances are created
        // automatically when the current one is marked COMPLETED.
        const firstInstance = await tx.task.create({
          data: {
            ticketNumber: await allocateTicketNumber(tx, link.boardId),
            title,
            description,
            priority,
            status: 'TODO' as const,
            progressPercentage: 0,
            taskType,
            isCascading: taskType === 'CASCADING',
            dueDate: occurrences[0],
            startDate: occurrences[0],
            assigneeId: assigneeId || session.user.id,
            creatorId: session.user.id,
            teamId: link.teamId,
            assignedById: assignedById || session.user.id,
            location: location || null,
            meetingLink: meetingLink || null,
            allDay: allDay !== undefined ? allDay : false,
            recurrence: rruleString,
            isRecurring: false,
            recurringParentId: templateTask.id,
            taskWeight: taskWeight || null,
            slaHours: slaHours || null,
            reminderDays: reminderDays || [],
            boardId: link.boardId,
            customStatusId: link.boardId ? (customStatusId ?? null) : null,
          }
        })

        if (taskType === 'TEAM' && teamMemberIds.length > 0) {
          await tx.taskTeamMember.createMany({
            data: teamMemberIds.map(userId => ({ taskId: firstInstance.id, userId, role: 'MEMBER' as const }))
          })
        }

        if (taskType === 'COLLABORATION' && collaboratorIds.length > 0) {
          await tx.taskCollaborator.createMany({
            data: collaboratorIds.map(userId => ({ taskId: firstInstance.id, userId }))
          })
        }

        await setTaskAssignees(tx, firstInstance.id, [assigneeId || session.user.id, ...teamMemberIds, ...collaboratorIds])
        await setTaskFieldValues(tx, firstInstance.id, fieldValues)

        // Attachments live on the visible instance. Future occurrences spawned
        // from the template on completion do not inherit them.
        if (attachmentRows.length > 0) {
          await tx.taskAttachment.createMany({
            data: attachmentRows.map((a) => ({ ...a, taskId: firstInstance.id }))
          })
        }

        return { template: templateTask, firstInstance, totalOccurrences: occurrences.length }
      })

      await prisma.activity.create({
        data: {
          type: 'TASK_CREATED',
          description: `Created recurring task: ${title} (first of ${totalOccurrences} instances)`,
          userId: session.user.id,
          entityId: template.id,
          entityType: 'task',
        }
      })

      if (firstInstance) {
        await broadcastTaskChange(firstInstance.id, 'created', { boardId: firstInstance.boardId })
      }

      return NextResponse.json({ template, firstInstance, totalOccurrences }, { status: 201 })
    }

    // Create task with transaction for related data
    const task = await prisma.$transaction(async (tx) => {
      // Verify parent task exists if parentId provided
      // Subtasks carry no boardId of their own; their roles come from the
      // parent's board, so that is the board a subtask's role must belong to.
      let governingBoardId: string | null = link.boardId
      if (parentId) {
        const parentTask = await tx.task.findUnique({
          where: { id: parentId },
          select: { id: true, creatorId: true, boardId: true, parent: { select: { boardId: true } } }
        })
        if (!parentTask) {
          throw new Error('Parent task not found')
        }
        governingBoardId = governingBoardId ?? parentTask.boardId ?? parentTask.parent?.boardId ?? null
      }

      /** Every holder of the role, owner first. Throws if it cannot take work. */
      const resolveRole = async (roleId: string): Promise<string[]> => {
        const role = await tx.boardRole.findUnique({
          where: { id: roleId },
          select: { name: true, boardId: true, assignments: { select: { userId: true } } },
        })
        // A role is only meaningful on its own board. Without a governing board
        // there is nothing to check it against, so refuse rather than accept
        // any role from anywhere.
        if (!role || !governingBoardId || role.boardId !== governingBoardId) {
          throw new RoleAddressingError('That role does not belong to this task\'s board.')
        }
        const outcome = resolveRoleAddressing({ name: role.name, holderIds: role.assignments.map(a => a.userId) })
        if (outcome.kind === 'reject') throw new RoleAddressingError(outcome.reason)
        return outcome.userIds
      }

      // Role addressing, same rules as PATCH: one holder is a shortcut so assign
      // them; several leaves it claimable; none would be invisible work and is
      // refused. Resolved here so a create cannot bypass the rule the edit path
      // enforces.
      const roleHolderIds: string[] = assignedRoleId ? await resolveRole(assignedRoleId) : []
      // Several holders make it a team task (a cascading task keeps its type;
      // its holders still all land in the flat assignee list below).
      const effectiveTaskType =
        roleHolderIds.length > 1 && taskType !== 'CASCADING' ? 'TEAM' : taskType
      const effectiveTeamMemberIds = assignedRoleId ? roleHolderIds.slice(1) : teamMemberIds

      // Ticket number. Allocated inside this transaction so two concurrent
      // creates cannot be handed the same number; a manual value is validated
      // and pulls the owning counter up behind it.
      const ticket = manualTicketNumber
        ? await applyManualTicketNumber(tx, manualTicketNumber)
        : await allocateTicketNumber(tx, link.boardId)

      // Create the task
      const newTask = await tx.task.create({
        data: {
          ticketNumber: ticket,
          assignedRoleId: assignedRoleId || null,
          title,
          description,
          priority,
          status: finalStatus || 'TODO',
          progressPercentage: finalProgress,
          taskType: effectiveTaskType,
          isCascading: taskType === 'CASCADING',
          dueDate: finalDueDate,
          startDate: finalStartDate,
          // A role-addressed task is owned by its first holder — never by the
          // creator just because they filled in the form.
          assigneeId: assignedRoleId
            ? roleHolderIds[0]
            : (assigneeId || session.user.id),
          creatorId: session.user.id,
          teamId: link.teamId, // set when created on a team board
          assignedById: assignedById || session.user.id,
          parentId: parentId || null,
          // New Google Calendar fields
          location: location || null,
          meetingLink: meetingLink || null,
          allDay: allDay || false,
          recurrence: recurrence || null,
          // New fields
          taskWeight: taskWeight || null,
          slaHours: slaHours || null,
          reminderDays: reminderDays || [],
          boardId: link.boardId,
          customStatusId: link.boardId ? (customStatusId ?? null) : null,
        },
      })

      // Add team members if this is a team task
      if (effectiveTaskType === 'TEAM' && effectiveTeamMemberIds.length > 0) {
        const teamMemberData = effectiveTeamMemberIds.map(userId => ({
          taskId: newTask.id,
          userId,
          role: 'MEMBER' as const, // All are members, current user is the leader by default
        }))

        await tx.taskTeamMember.createMany({
          data: teamMemberData,
        })
      }

      // Add collaborators if this is a collaboration task
      if (taskType === 'COLLABORATION' && collaboratorIds.length > 0) {
        const collaboratorData = collaboratorIds.map(userId => ({
          taskId: newTask.id,
          userId,
        }))

        await tx.taskCollaborator.createMany({
          data: collaboratorData,
        })
      }

      // A role-addressed task lists only its resolved holder (if any) — never
      // the creator, which is what made "Assigned To" show up on role tasks.
      await setTaskAssignees(
        tx,
        newTask.id,
        assignedRoleId
          ? roleHolderIds
          : [assigneeId || session.user.id, ...teamMemberIds, ...collaboratorIds],
      )
      await setTaskFieldValues(tx, newTask.id, fieldValues)

      // Persist file attachments on the new task
      if (attachmentRows.length > 0) {
        await tx.taskAttachment.createMany({
          data: attachmentRows.map((a) => ({ ...a, taskId: newTask.id }))
        })
      }

      // Create cascade steps for CASCADING tasks
      if (taskType === 'CASCADING' && cascadeSteps.length > 0) {
        for (let i = 0; i < cascadeSteps.length; i++) {
          const step = cascadeSteps[i]
          const stepOrder = i + 1
          const stepHolderIds = step.assignedRoleId
            ? await resolveRole(step.assignedRoleId)
            : (step.assigneeId ? [step.assigneeId] : [])
          const stepAssigneeId = stepHolderIds[0] ?? null
          const cascadeStep = await tx.task.create({
            data: {
              title: step.title,
              description: step.description || null,
              priority,
              status: 'TODO',
              progressPercentage: 0,
              taskType: 'INDIVIDUAL',
              isCascading: false,
              dueDate: step.dueDate ? new Date(step.dueDate) : finalDueDate,
              startDate: step.dueDate ? new Date(step.dueDate) : finalStartDate,
              assigneeId: stepAssigneeId,
              assignedRoleId: step.assignedRoleId || null,
              creatorId: session.user.id,
              assignedById: session.user.id,
              parentId: newTask.id,
              cascadeOrder: stepOrder,
              isLocked: stepOrder > 1, // first step is unlocked, rest are locked
            },
          })
          await setTaskAssignees(tx, cascadeStep.id, stepHolderIds)
        }
      }

      // Return task with all relations
      return await tx.task.findUnique({
        where: { id: newTask.id },
        include: {
          assignee: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          creator: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          assignedBy: {
            select: { 
              id: true, 
              firstName: true,
              lastName: true,
              name: true, 
              email: true, 
              image: true,
              role: true,
              hierarchyLevel: true
            }
          },
          team: {
            select: { id: true, name: true }
          },
          teamMembers: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
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
                  firstName: true,
                  lastName: true,
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
                  firstName: true,
                  lastName: true,
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

    // Log activity
    if (task) {
      await prisma.activity.create({
        data: {
          type: 'TASK_CREATED',
          description: `Created task: ${title}`,
          userId: session.user.id,
          entityId: task.id,
          entityType: 'task',
        }
      })

      // Auto-sync to Google Calendar if enabled
      if (task.dueDate) {
        await autoSyncTask(task.id, session.user.id)
      }

      // Send notifications to all involved users (assignee, team members, collaborators)
      const assignerName = session.user.name || session.user.email || 'Someone'
      const usersToNotify = new Set<string>()

      // Add direct assignee
      const taskAssigneeId = task.assigneeId || assigneeId
      if (taskAssigneeId && taskAssigneeId !== session.user.id) {
        usersToNotify.add(taskAssigneeId)
      }

      // Add team members (for TEAM tasks)
      if (task.teamMembers && task.teamMembers.length > 0) {
        task.teamMembers.forEach((tm: any) => {
          if (tm.user?.id && tm.user.id !== session.user.id) {
            usersToNotify.add(tm.user.id)
          }
        })
      }

      // Add collaborators (for COLLABORATION tasks)
      if (task.collaborators && task.collaborators.length > 0) {
        task.collaborators.forEach((c: any) => {
          if (c.user?.id && c.user.id !== session.user.id) {
            usersToNotify.add(c.user.id)
          }
        })
      }

      console.log('Task created - users to notify:', Array.from(usersToNotify), { parentId })

      // Send notifications to all users
      for (const userId of usersToNotify) {
        try {
          if (parentId) {
            // Get parent task title for subtask notification
            const parentTask = await prisma.task.findUnique({
              where: { id: parentId },
              select: { title: true }
            })
            console.log('Sending subtask notification to:', userId)
            await notifySubtaskAssigned(
              userId,
              task.id,
              title,
              parentTask?.title || 'Parent Task',
              assignerName
            )
            console.log('Subtask notification sent successfully to:', userId)
          } else {
            console.log('Sending task notification to:', userId)
            await notifyTaskAssigned(userId, task.id, title, assignerName)
            console.log('Task notification sent successfully to:', userId)
          }
        } catch (notificationError) {
          console.error('Error sending notification to', userId, ':', notificationError)
          // Don't fail the task creation if notification fails
        }
      }

      // For cascading tasks, notify the first step's assignee
      if (taskType === 'CASCADING' && cascadeSteps.length > 0) {
        const firstStep = cascadeSteps[0]
        try {
          // Read the stored assignee: a role-addressed step resolves on create.
          const firstStepTask = await prisma.task.findFirst({
            where: { parentId: task.id, cascadeOrder: 1 },
            select: { id: true, assigneeId: true }
          })
          if (firstStepTask?.assigneeId && firstStepTask.assigneeId !== session.user.id) {
            await notifySubtaskAssigned(
              firstStepTask.assigneeId,
              firstStepTask.id,
              firstStep.title,
              title,
              assignerName
            )
          }
        } catch (notificationError) {
          console.error('Error sending cascade step 1 notification:', notificationError)
        }
      }
    }

    // Push the new card to every open board/dashboard that should show it.
    if (task) await broadcastTaskChange(task.id, 'created', { boardId: task.boardId })

    return NextResponse.json(task, { status: 201 })
  } catch (error) {
    console.error('Task creation error:', error)

    if (error instanceof RoleAddressingError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // A rejected ticket number is user input, not a server fault.
    if (error instanceof TicketNumberError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

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