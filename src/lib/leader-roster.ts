import { prisma } from '@/lib/prisma'

/**
 * Who counts as "a leader's people".
 *
 * The app keeps two deliberately separate models (product decision 2026-06-10):
 *
 *   * **reports-to** — `LeaderMembership`, the stable org hierarchy.
 *   * **teams** — `Team` / `TeamMember`, the flexible project layer. Adding
 *     someone to a team never touches reports-to.
 *
 * Member Management historically read only the first, so anyone a leader added
 * to a team they created was simply absent from the page. This resolves the
 * union once so every surface (the roster, the per-member stats) agrees on it.
 */

export type MemberSource = 'reports-to' | 'team'

export interface LeaderRoster {
  /** Every user id in the roster, de-duplicated. */
  memberIds: string[]
  /** Ids that came from LeaderMembership. */
  hierarchyIds: Set<string>
  /** userId → the managed teams that user belongs to. */
  teamsByUser: Map<string, { id: string; name: string }[]>
  /** All teams this leader manages, for the page's team filter. */
  managedTeams: { id: string; name: string }[]
}

/**
 * Resolve the roster for `leaderId`.
 *
 * A leader "manages" a team if they own it or hold the per-team LEADER role —
 * the same rule as `canManageTeam`. Teams where they are only a MEMBER belong
 * to someone else's Member Management, not theirs.
 *
 * Passing `teamIdFilter` narrows to one team and drops the reports-to source:
 * "show me this team" is a question about that team alone.
 */
export async function resolveLeaderRoster(
  leaderId: string,
  teamIdFilter?: string | null
): Promise<LeaderRoster> {
  const managedTeams = await prisma.team.findMany({
    where: {
      OR: [
        { ownerId: leaderId },
        { members: { some: { userId: leaderId, role: 'LEADER' } } },
      ],
    },
    select: { id: true, name: true, members: { select: { userId: true } } },
    orderBy: { name: 'asc' },
  })

  const teamsByUser = new Map<string, { id: string; name: string }[]>()
  for (const team of managedTeams) {
    if (teamIdFilter && team.id !== teamIdFilter) continue
    for (const m of team.members) {
      if (m.userId === leaderId) continue // a leader is not their own report
      const list = teamsByUser.get(m.userId) ?? []
      list.push({ id: team.id, name: team.name })
      teamsByUser.set(m.userId, list)
    }
  }

  const hierarchyIds = new Set<string>()
  if (!teamIdFilter) {
    const rows = await prisma.leaderMembership.findMany({
      where: { leaderId },
      select: { memberId: true },
    })
    for (const r of rows) hierarchyIds.add(r.memberId)
  }

  const idSet = new Set<string>()
  hierarchyIds.forEach((id) => idSet.add(id))
  teamsByUser.forEach((_, id) => idSet.add(id))
  const memberIds = Array.from(idSet)

  return {
    memberIds,
    hierarchyIds,
    teamsByUser,
    managedTeams: managedTeams.map(({ id, name }) => ({ id, name })),
  }
}

/** Tag a loaded user with where they came from, for the UI's source badges. */
export function annotateMemberSource<T extends { id: string }>(
  member: T,
  roster: LeaderRoster
): T & { sources: MemberSource[]; teams: { id: string; name: string }[] } {
  const teams = roster.teamsByUser.get(member.id) ?? []
  const sources: MemberSource[] = []
  if (roster.hierarchyIds.has(member.id)) sources.push('reports-to')
  if (teams.length > 0) sources.push('team')
  return { ...member, sources, teams }
}
