import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateRawToken, hashToken } from '@/lib/api-token'

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
})

// GET: list the caller's active (non-revoked) tokens — metadata only, never the secret.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tokens = await prisma.apiToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ tokens })
}

// POST: create a token. Returns the raw token exactly once.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let name: string
  try {
    ;({ name } = createSchema.parse(await req.json()))
  } catch {
    return NextResponse.json({ error: 'A token name is required' }, { status: 400 })
  }

  const raw = generateRawToken()
  const token = await prisma.apiToken.create({
    data: { userId: session.user.id, name, tokenHash: hashToken(raw) },
    select: { id: true, name: true, createdAt: true },
  })

  // `token` (raw) is returned here and NEVER again.
  return NextResponse.json({ ...token, token: raw }, { status: 201 })
}
