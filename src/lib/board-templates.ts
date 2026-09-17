import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Shared by the board template routes (route files may only export handlers). */
export const templateSchema = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(60),
  titlePrefix: z.string().trim().max(60).nullish(),
  description: z.string().max(2000).nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullish(),
  taskWeight: z.number().int().min(1).max(5).nullish(),
  slaHours: z.number().int().min(1).nullish(),
  defaultRoleId: z.string().nullish(),
  // Seeded as subtasks (or steps) on a new task. Titles only.
  checklist: z.array(z.object({ title: z.string().trim().min(1).max(200) })).max(50).nullish(),
})

export function templatePayload(data: z.infer<typeof templateSchema>) {
  return {
    name: data.name,
    titlePrefix: data.titlePrefix ?? null,
    description: data.description ?? null,
    priority: data.priority ?? null,
    taskWeight: data.taskWeight ?? null,
    slaHours: data.slaHours ?? null,
    defaultRoleId: data.defaultRoleId ?? null,
    checklist: data.checklist ?? Prisma.JsonNull,
  }
}

/** A default role pointing at another board's role would address nobody here. */
export async function roleBelongsToBoard(roleId: string | null | undefined, boardId: string) {
  if (!roleId) return true
  const role = await prisma.boardRole.findFirst({ where: { id: roleId, boardId }, select: { id: true } })
  return !!role
}

export function templateError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.errors[0]?.message || 'Invalid input', details: error.errors }, { status: 400 })
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return NextResponse.json({ error: 'This board already has a template with that name.' }, { status: 409 })
  }
  console.error(`Board template ${action} error:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

