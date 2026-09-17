import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canManageTeam, wouldLeaveTeamLeaderless } from '@/lib/team-permissions'
import { syncTeamMembersToLeaders } from '@/lib/team-leader-sync'

const patchSchema = z.object({ role: z.enum(['LEADER', 'MEMBER']) })

async function loadTeamForAuth(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  })
}

// PATCH — promote/demote a member. Blocked if it would leave the team with zero leaders.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await loadTeamForAuth(params.id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isAdmin = session.user.role === 'ADMIN'
  if (!isAdmin && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!team.members.some((m) => m.userId === params.userId)) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  try {
    const { role } = patchSchema.parse(await req.json())
    if (wouldLeaveTeamLeaderless(team.members, { userId: params.userId, action: 'setRole', role })) {
      return NextResponse.json({ error: 'A team must keep at least one leader' }, { status: 400 })
    }
    const member = await prisma.teamMember.update({
      where: { userId_teamId: { userId: params.userId, teamId: params.id } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true, image: true, role: true, positionTitle: true } } },
    })
    // A new team leader picks up the board's people (additive only).
    if (role === 'LEADER') {
      await syncTeamMembersToLeaders(params.id).catch((e) => console.error('Leader sync failed:', e))
    }
    return NextResponse.json({ member })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: error.errors }, { status: 400 })
    }
    console.error('Team member PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE — remove a member. Blocked if it would leave the team with zero leaders.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await loadTeamForAuth(params.id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // A member may remove themselves (leave); otherwise leader/admin only.
  const isSelf = params.userId === session.user.id
  const isAdmin = session.user.role === 'ADMIN'
  if (!isSelf && !isAdmin && !canManageTeam(session.user.id, team)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!team.members.some((m) => m.userId === params.userId)) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (wouldLeaveTeamLeaderless(team.members, { userId: params.userId, action: 'remove' })) {
    return NextResponse.json({ error: 'A team must keep at least one leader' }, { status: 400 })
  }

  try {
    await prisma.teamMember.delete({
      where: { userId_teamId: { userId: params.userId, teamId: params.id } },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Team member DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
