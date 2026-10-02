import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET — the signed-in user's team invitations waiting for an answer.
export async function GET(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invitations = await prisma.teamInvitation.findMany({
    where: { userId: session.user.id, status: 'PENDING' },
    include: {
      team: { select: { id: true, name: true, description: true } },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ invitations })
}
