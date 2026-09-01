import { NextRequest, NextResponse } from 'next/server'
import { allocateTicketNumber } from '@/lib/ticket-allocate'
import { prisma } from '@/lib/prisma'
import { setTaskAssignees } from '@/lib/task-assignees'
import { setTaskFieldValues } from '@/lib/task-fields'
import { notifyTaskAssigned } from '@/lib/notifications'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// Per-IP rate limit (per server instance). Deters casual abuse of this public
// endpoint; not a substitute for a shared store but adequate for intake forms.
const RATE = new Map<string, { count: number; resetAt: number }>()
const LIMIT = 10
const WINDOW_MS = 60 * 60 * 1000
function rateLimited(ip: string): boolean {
  const now = Date.now()
  // Bound the map: x-forwarded-for is client-controlled, so a spoofed-IP flood
  // could otherwise grow it unbounded. This is best-effort (per-process), so the
  // real protections are the enable-toggle + honeypot, not this limiter.
  if (RATE.size > 10_000) RATE.clear()
  const e = RATE.get(ip)
  if (!e || now > e.resetAt) {
    RATE.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  e.count++
  return e.count > LIMIT
}

const submitSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  title: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  // Caps on anonymous input — a public endpoint must bound every field.
  fieldValues: z.array(z.object({ fieldId: z.string(), value: z.string().max(2000).nullable() })).max(50).optional(),
  _hp: z.string().max(200).optional(), // honeypot — real users leave this empty
})

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const parsed = submitSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please fill in all required fields.' }, { status: 400 })
    }
    const data = parsed.data

    // Honeypot: bots fill the hidden field — pretend success, create nothing.
    if (data._hp && data._hp.trim() !== '') return NextResponse.json({ ok: true })

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'Too many submissions. Please try again later.' }, { status: 429 })
    }

    const form = await prisma.intakeForm.findUnique({
      where: { token: params.token },
      include: {
        board: {
          select: {
            id: true,
            ownerId: true,
            fields: { select: { id: true } },
            statuses: { select: { id: true, category: true, isDefault: true, position: true }, orderBy: { position: 'asc' } },
          },
        },
      },
    })
    if (!form || !form.enabled) {
      return NextResponse.json({ error: 'This form is not available.' }, { status: 404 })
    }

    // Resolve the target column + its category.
    const statuses = form.board.statuses
    const target =
      (form.targetStatusId && statuses.find((s) => s.id === form.targetStatusId)) ||
      statuses.find((s) => s.isDefault && s.category === 'TODO') ||
      statuses[0] ||
      null
    const category = (target?.category as any) || 'TODO'

    // Only accept values for fields that actually belong to this board.
    const allowed = new Set(form.board.fields.map((f) => f.id))
    const fieldValues = (data.fieldValues || []).filter((v) => allowed.has(v.fieldId))

    // Use the configured assignee if it's still a real user, else the board owner
    // (a stale defaultAssigneeId would otherwise 500 on the FK).
    let assigneeId = form.board.ownerId
    if (form.defaultAssigneeId && form.defaultAssigneeId !== form.board.ownerId) {
      const exists = await prisma.user.findUnique({ where: { id: form.defaultAssigneeId }, select: { id: true } })
      if (exists) assigneeId = form.defaultAssigneeId
    }
    const description =
      `📨 Submitted via form by ${data.name} <${data.email}>` +
      (data.description ? `\n\n${data.description}` : '')

    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          ticketNumber: await allocateTicketNumber(tx, form.board.id),
          title: data.title.trim(),
          description,
          priority: 'MEDIUM',
          status: category,
          taskType: 'INDIVIDUAL',
          progressPercentage: 0,
          creatorId: form.board.ownerId,
          assigneeId,
          boardId: form.board.id,
          customStatusId: target?.id || null,
        },
        select: { id: true },
      })
      await setTaskAssignees(tx, task.id, [assigneeId])
      await setTaskFieldValues(tx, task.id, fieldValues)
      return task
    })

    // Notify the assignee — fire-and-forget so the public submit returns
    // immediately and never rides on email/push latency.
    void notifyTaskAssigned(assigneeId, created.id, data.title.trim(), 'Form submission').catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Form submit error:', error)
    return NextResponse.json({ error: 'Could not submit. Please try again.' }, { status: 500 })
  }
}
