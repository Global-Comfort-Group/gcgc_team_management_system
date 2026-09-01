import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canManageTeam } from '@/lib/team-permissions'
import { normalisePrefix } from '@/lib/ticket-number'

const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  // Ticket prefix for this team's board ("OPS" => OPS-1, OPS-2). Empty string
  // clears it, sending the board's tasks back to the global TMS- sequence.
  // Set here rather than via /api/boards/[id], which refuses team boards — and
  // every board in production is a team board.
  ticketPrefix: z.string().trim().max(10).optional(),
})

const teamInclude = {
  members: {
    include: { user: { select: { id: true, name: true, email: true, image: true, role: true } } },
  },
  board: { select: { id: true, name: true, color: true, ticketPrefix: true } },
  _count: { select: { members: true, tasks: true } },
}

async function loadTeamForAuth(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      ownerId: true,
      board: { select: { id: true } },
      members: { select: { userId: true, role: true } },
    },
  })
}

// GET — any member of the team may view it.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await prisma.team.findFirst({
    where: { id: params.id, members: { some: { userId: session.user.id } } },
    include: teamInclude,
  })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ team })
}

// PATCH — only team leaders (any LEADER member) or admins. Renames team and mirrors name/color to its board.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await loadTeamForAuth(params.id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = session.user.role === 'ADMIN'
  if (!isAdmin && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = updateTeamSchema.parse(await req.json())

    // Normalise and check the prefix before touching anything: it is unique
    // across boards, so a clash must be reported clearly rather than surfacing
    // as a constraint violation.
    let prefixUpdate: { ticketPrefix: string | null } | null = null
    if (data.ticketPrefix !== undefined) {
      const wanted = data.ticketPrefix ? normalisePrefix(data.ticketPrefix) : null
      if (data.ticketPrefix && !wanted) {
        return NextResponse.json(
          { error: 'Prefix must start with a letter and use only letters and numbers.' },
          { status: 400 }
        )
      }
      if (wanted && team.board) {
        const clash = await prisma.kanbanBoard.findFirst({
          where: { ticketPrefix: wanted, id: { not: team.board.id } },
          select: { name: true },
        })
        if (clash) {
          return NextResponse.json(
            { error: `Prefix "${wanted}" is already used by the board "${clash.name}".` },
            { status: 409 }
          )
        }
      }
      prefixUpdate = { ticketPrefix: wanted }
    }

    const updated = await prisma.team.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        // Mirror name/color onto the team's board so the switcher tab matches.
        // Guarded: admin-created teams may have no board, and a nested update of a
        // missing relation throws. Only update the board when one exists and a
        // board-relevant field changed.
        ...(team.board && (data.name !== undefined || data.color !== undefined || prefixUpdate)
          ? {
              board: {
                update: {
                  ...(data.name !== undefined ? { name: data.name } : {}),
                  ...(data.color !== undefined ? { color: data.color } : {}),
                  ...(prefixUpdate ?? {}),
                },
              },
            }
          : {}),
      },
      include: teamInclude,
    })
    return NextResponse.json({ team: updated })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Team PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — only team leaders or admins. Cascade removes the team's board, memberships, and tasks
// (Task.team and KanbanBoard.team both onDelete: Cascade).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await loadTeamForAuth(params.id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = session.user.role === 'ADMIN'
  if (!isAdmin && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await prisma.team.delete({ where: { id: params.id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Team DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
