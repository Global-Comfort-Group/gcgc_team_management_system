import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canManageTeam } from '@/lib/team-permissions'

// DELETE — a team leader (or admin) cancels an invitation that hasn't been answered.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; invitationId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await prisma.team.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  })
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.user.role !== 'ADMIN' && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { count } = await prisma.teamInvitation.updateMany({
    where: { id: params.invitationId, teamId: params.id, status: 'PENDING' },
    data: { status: 'CANCELLED', respondedAt: new Date() },
  })
  if (count === 0) return NextResponse.json({ error: 'No pending invitation to cancel' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
