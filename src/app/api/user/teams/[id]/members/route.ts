import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canManageTeam } from '@/lib/team-permissions'
import { inviteToTeam } from '@/lib/team-invitations'

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['LEADER', 'MEMBER']).default('MEMBER'),
})

async function loadTeamForAuth(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  })
}

// GET — any team member may list the roster.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isMember = await prisma.teamMember.findFirst({
    where: { teamId: params.id, userId: session.user.id },
    select: { id: true },
  })
  if (!isMember) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const members = await prisma.teamMember.findMany({
    where: { teamId: params.id },
    include: { user: { select: { id: true, name: true, email: true, image: true, role: true, positionTitle: true } } },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  })
  return NextResponse.json({ members })
}

// POST — INVITE an existing active user to the team (role optional, default
// MEMBER). They join only when they accept (field reports 2026-10), at which
// point they are added under the team board's leaders — see team-invitations.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await loadTeamForAuth(params.id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = session.user.role === 'ADMIN'
  if (!isAdmin && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { userId, role } = addMemberSchema.parse(await req.json())

    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } })
    if (!user) return NextResponse.json({ error: 'User not found or inactive' }, { status: 404 })

    const teamRow = await prisma.team.findUnique({ where: { id: params.id }, select: { name: true } })
    const result = await inviteToTeam({
      teamId: params.id,
      teamName: teamRow?.name ?? 'a team',
      userId,
      role,
      invitedById: session.user.id,
      inviterName: session.user.name || session.user.email || 'A team leader',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ invitation: result.invitation }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'User is already a team member' }, { status: 409 })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Team members POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
