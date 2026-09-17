import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | PrismaClient

/**
 * Team-board members join their board leaders' teams (field report 2026-09).
 *
 * Team Overview lists a leader's people from `LeaderMembership` (reports-to)
 * plus teams the leader *manages*. Someone on a team board whose leader was
 * not the team's owner or LEADER-role member — the usual case when an admin set
 * the team up — never appeared there. Adding the reports-to link closes that.
 *
 * Leaders of a team board are: the team owner, members holding the team's
 * LEADER role, and the owner of the team's board — limited to accounts whose
 * system role is LEADER (an admin's "team" is everyone already).
 *
 * Additive only. Removing someone from the board does NOT remove the link:
 * reports-to is the stable org layer and is edited on purpose, not as a side
 * effect (decision 2026-09).
 *
 * Returns the number of links created.
 */
export async function syncTeamMembersToLeaders(
  teamId: string,
  db: Db = defaultPrisma,
): Promise<number> {
  const pairs = await planTeamLeaderLinks(teamId, db)
  if (pairs.length === 0) return 0
  const res = await db.leaderMembership.createMany({ data: pairs, skipDuplicates: true })
  return res.count
}

/** The links a team needs, minus those that already exist. No writes. */
export async function planTeamLeaderLinks(
  teamId: string,
  db: Db = defaultPrisma,
): Promise<Array<{ leaderId: string; memberId: string }>> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      ownerId: true,
      members: { select: { userId: true, role: true } },
      board: { select: { ownerId: true } },
    },
  })
  // Only teams that actually have a board — this is about team boards.
  // (A team has at most one: KanbanBoard.teamId is unique.)
  if (!team || !team.board) return []

  const candidateLeaders = new Set<string>()
  if (team.ownerId) candidateLeaders.add(team.ownerId)
  for (const m of team.members) if (m.role === 'LEADER') candidateLeaders.add(m.userId)
  candidateLeaders.add(team.board.ownerId)
  if (candidateLeaders.size === 0) return []

  const leaders = await db.user.findMany({
    where: { id: { in: Array.from(candidateLeaders) }, role: 'LEADER', isActive: true },
    select: { id: true },
  })
  if (leaders.length === 0) return []

  const memberIds = team.members.map(m => m.userId)
  const existing = await db.leaderMembership.findMany({
    where: { leaderId: { in: leaders.map(l => l.id) }, memberId: { in: memberIds } },
    select: { leaderId: true, memberId: true },
  })
  const have = new Set(existing.map(e => `${e.leaderId}:${e.memberId}`))

  const pairs: Array<{ leaderId: string; memberId: string }> = []
  for (const { id: leaderId } of leaders) {
    for (const memberId of memberIds) {
      // Nobody reports to themselves, and co-leaders of one board do not
      // become each other's reports.
      if (memberId === leaderId || candidateLeaders.has(memberId)) continue
      if (have.has(`${leaderId}:${memberId}`)) continue
      pairs.push({ leaderId, memberId })
    }
  }
  return pairs
}
