import type { TeamInvitationStatus, TeamMemberRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { syncTeamMembersToLeaders } from '@/lib/team-leader-sync'

/**
 * Team invitations (field reports 2026-10). Adding someone to a team no longer
 * makes them a member: it sends an invitation they accept or decline, and the
 * TeamMember row is created only on accept.
 *
 * One row per (team, user). A decline or cancel can be followed by a fresh
 * invite, which reuses the row and sets it back to PENDING.
 */

export type InviteDecision =
  | { ok: true; reuse: boolean }
  | { ok: false; status: number; error: string }

/** Whether an invite may be sent, given what already exists. Pure. */
export function decideInvite(state: {
  isMember: boolean
  existing: { status: TeamInvitationStatus } | null
}): InviteDecision {
  if (state.isMember) return { ok: false, status: 400, error: 'User is already a team member' }
  if (state.existing?.status === 'PENDING') return { ok: false, status: 409, error: 'An invitation is already waiting for this person' }
  return { ok: true, reuse: !!state.existing }
}

export type ResponseDecision = { ok: true } | { ok: false; status: number; error: string }

/** Whether this user may answer this invitation. Pure. */
export function decideResponse(inv: { userId: string; status: TeamInvitationStatus } | null, userId: string): ResponseDecision {
  if (!inv || inv.userId !== userId) return { ok: false, status: 404, error: 'Invitation not found' }
  if (inv.status !== 'PENDING') return { ok: false, status: 409, error: `This invitation was already ${inv.status.toLowerCase()}` }
  return { ok: true }
}

export async function inviteToTeam(opts: {
  teamId: string
  teamName: string
  userId: string
  role: TeamMemberRole
  invitedById: string
  inviterName: string
}) {
  const [member, existing] = await Promise.all([
    prisma.teamMember.findUnique({ where: { userId_teamId: { userId: opts.userId, teamId: opts.teamId } }, select: { id: true } }),
    prisma.teamInvitation.findUnique({ where: { teamId_userId: { teamId: opts.teamId, userId: opts.userId } }, select: { status: true } }),
  ])
  const decision = decideInvite({ isMember: !!member, existing })
  if (!decision.ok) return decision

  const invitation = await prisma.teamInvitation.upsert({
    where: { teamId_userId: { teamId: opts.teamId, userId: opts.userId } },
    create: { teamId: opts.teamId, userId: opts.userId, role: opts.role, invitedById: opts.invitedById },
    update: { role: opts.role, invitedById: opts.invitedById, status: 'PENDING', createdAt: new Date(), respondedAt: null },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  })
  await createNotification({
    userId: opts.userId,
    type: 'TEAM_INVITATION',
    title: 'Team invitation',
    message: `${opts.inviterName} invited you to join the team "${opts.teamName}". Accept or decline it under Teams.`,
    entityId: invitation.id,
    entityType: 'team_invitation',
  }).catch((e) => console.error('[invite] notify failed', e))
  return { ok: true as const, invitation }
}

export async function respondToInvitation(invitationId: string, userId: string, accept: boolean) {
  const inv = await prisma.teamInvitation.findUnique({
    where: { id: invitationId },
    include: { team: { select: { id: true, name: true } }, user: { select: { name: true, email: true } } },
  })
  const decision = decideResponse(inv, userId)
  if (!decision.ok || !inv) return decision

  await prisma.$transaction(async (tx) => {
    await tx.teamInvitation.update({
      where: { id: inv.id },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date() },
    })
    if (accept) {
      await tx.teamMember.upsert({
        where: { userId_teamId: { userId, teamId: inv.teamId } },
        create: { userId, teamId: inv.teamId, role: inv.role },
        update: {},
      })
    }
  })
  if (accept) await syncTeamMembersToLeaders(inv.teamId).catch((e) => console.error('Leader sync failed:', e))

  const who = inv.user.name || inv.user.email
  await createNotification({
    userId: inv.invitedById,
    type: 'TEAM_INVITATION',
    title: accept ? 'Invitation accepted' : 'Invitation declined',
    message: `${who} ${accept ? 'accepted' : 'declined'} your invitation to "${inv.team.name}".`,
    entityId: inv.teamId,
    entityType: 'team',
  }).catch((e) => console.error('[invite] notify inviter failed', e))
  return { ok: true as const, teamId: inv.teamId }
}
