import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateApiToken } from '@/lib/api-token'
import { accessibleBoardWhere } from '@/lib/board-access'

/**
 * List the boards the token owner can post tasks to: owned, an explicit member
 * of, or a member of the board's team. The agent uses the returned `id` values
 * as `boardId` in POST /api/public/tasks.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiToken(req)
  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid or missing API token' },
      { status: 401 }
    )
  }
  const { user } = auth

  const boards = await prisma.kanbanBoard.findMany({
    where: accessibleBoardWhere(user.id),
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ boards })
}
