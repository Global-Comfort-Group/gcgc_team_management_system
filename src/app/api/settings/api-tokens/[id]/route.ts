import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// DELETE: revoke a token (soft — sets revokedAt). Scoped to the caller's own tokens.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await prisma.apiToken.updateMany({
    where: { id: params.id, userId: session.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
