import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateApiToken } from '@/lib/api-token'
import { resolveTeamBoardLink } from '@/lib/team-board'
import { setTaskAssignees } from '@/lib/task-assignees'
import { rateLimit } from '@/lib/rate-limit'
import { accessibleBoardWhere } from '@/lib/board-access'

// Accepts a full ISO datetime or a bare YYYY-MM-DD (stored at UTC midnight).
const dateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid date' })

const subtaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(5000).optional(),
    dueDate: dateString.optional(),
  })
  .strict()

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(5000).optional(),
    dueDate: dateString.optional(),
    boardId: z.string().min(1).optional(),
    assignTo: z.enum(['me']).optional(), // "me" (token owner) or omitted (unassigned)
    subtasks: z.array(subtaskSchema).max(50).optional(),
  })
  .strict()

const parseDate = (v?: string): Date | null => (v ? new Date(v) : null)

export async function POST(req: NextRequest) {
  // 1. Authenticate via API token
  const auth = await authenticateApiToken(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid or missing API token' },
      { status: 401 }
    )
  }
  const { user } = auth

  // 2. Best-effort per-token rate limit
  const rl = rateLimit(`public-tasks:${auth.tokenId}`, {
    windowMs: 60_000,
    max: 60,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    )
  }

  // 3. Validate body
  let body: z.infer<typeof createTaskSchema>
  try {
    body = createTaskSchema.parse(await req.json())
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') : 'Invalid JSON body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // 4. Resolve + authorize board (must be one the caller owns or is a member of)
  let board: { id: string; name: string } | null = null
  if (body.boardId) {
    board = await prisma.kanbanBoard.findFirst({
      where: {
        id: body.boardId,
        ...accessibleBoardWhere(user.id),
      },
      select: { id: true, name: true },
    })
    if (!board) {
      return NextResponse.json(
        { error: 'Board not found or not accessible. Call GET /api/public/boards to list your boards.' },
        { status: 400 }
      )
    }
  }

  const link = await resolveTeamBoardLink({ boardId: board?.id ?? null })
  const assigneeId = body.assignTo === 'me' ? user.id : null
  const dueDate = parseDate(body.dueDate)

  // 5. Create the task tree atomically
  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: body.title,
        description: body.description ?? null,
        priority: 'MEDIUM',
        status: 'TODO',
        progressPercentage: 0,
        dueDate,
        startDate: dueDate, // mirror UI: startDate defaults to dueDate for calendar display
        assigneeId,
        creatorId: user.id,
        assignedById: user.id,
        teamId: link.teamId,
        boardId: link.boardId,
      },
      select: { id: true, title: true, dueDate: true },
    })
    await setTaskAssignees(tx, task.id, assigneeId ? [assigneeId] : [])

    const subtasks: Array<{ id: string; title: string }> = []
    for (const sub of body.subtasks ?? []) {
      const child = await tx.task.create({
        data: {
          title: sub.title,
          description: sub.description ?? null,
          priority: 'MEDIUM',
          status: 'TODO',
          progressPercentage: 0,
          dueDate: parseDate(sub.dueDate),
          startDate: parseDate(sub.dueDate),
          assigneeId,
          creatorId: user.id,
          assignedById: user.id,
          teamId: link.teamId,
          boardId: link.boardId,
          parentId: task.id,
        },
        select: { id: true, title: true },
      })
      await setTaskAssignees(tx, child.id, assigneeId ? [assigneeId] : [])
      subtasks.push(child)
    }

    return { task, subtasks }
  })

  // 6. Activity log (non-blocking, mirrors the UI create path)
  prisma.activity
    .create({
      data: {
        type: 'TASK_CREATED',
        description: `Created task via API: ${created.task.title}`,
        userId: user.id,
        entityId: created.task.id,
        entityType: 'task',
      },
    })
    .catch(() => {})

  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? ''
  return NextResponse.json(
    {
      id: created.task.id,
      title: created.task.title,
      board: board ? { id: board.id, name: board.name } : null,
      dueDate: created.task.dueDate,
      assignees: assigneeId ? [{ id: user.id, name: user.name }] : [],
      subtasks: created.subtasks,
      url: appUrl ? `${appUrl}/user/tasks?taskId=${created.task.id}` : null,
    },
    { status: 201 }
  )
}
