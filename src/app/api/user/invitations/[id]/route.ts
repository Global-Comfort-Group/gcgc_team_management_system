import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRequestSession } from '@/lib/api-auth'
import { respondToInvitation } from '@/lib/team-invitations'

const schema = z.object({ action: z.enum(['accept', 'decline']) })

// POST { action: 'accept' | 'decline' } — the invitee answers. Accepting is
// what actually makes them a team member.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getRequestSession(req)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'action must be accept or decline' }, { status: 400 })

  const result = await respondToInvitation(params.id, session.user.id, parsed.data.action === 'accept')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
