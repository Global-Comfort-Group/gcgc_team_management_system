export type TeamMemberRole = 'LEADER' | 'MEMBER'

export interface TeamMemberUser {
  id: string
  name: string | null
  email: string
  image: string | null
  role: string
  positionTitle?: string | null
}

export interface TeamMember {
  id: string
  userId: string
  teamId: string
  role: TeamMemberRole
  user: TeamMemberUser
}

export interface TeamBoardRef {
  id: string
  name: string
  color: string
  progress?: number
}

export interface Team {
  id: string
  name: string
  description: string | null
  ownerId: string | null
  members: TeamMember[]
  board: TeamBoardRef | null
  _count?: { members: number; tasks: number }
}

/** A user the current user can add to a team (from GET /api/users). */
export interface SelectableUser {
  id: string
  name: string | null
  email: string
  image: string | null
  role: string
}
