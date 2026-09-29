import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { canViewTask } from '@/lib/task-access'
import { mentionableUserIds } from '@/lib/mention-scope'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q')
    
    if (!query || query.trim().length < 1) {
      return NextResponse.json({ users: [] })
    }

    // ?taskId= scopes the search to the people who can be @mentioned on that
    // task (its board's members) — see src/lib/mention-scope.ts.
    const taskId = searchParams.get('taskId')
    let scopeIds: string[] | undefined
    if (taskId) {
      const { allowed } = await canViewTask(taskId, session.user.id, session.user.role === 'ADMIN')
      if (!allowed) return NextResponse.json({ users: [] })
      scopeIds = Array.from(await mentionableUserIds(prisma, taskId))
    }

    // Search users by name or email, limit results
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { isActive: true },
          ...(scopeIds ? [{ id: { in: scopeIds } }] : []),
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
      take: 10, // Limit to 10 results for performance
      orderBy: [
        { name: 'asc' },
        { email: 'asc' }
      ]
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('User search error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}