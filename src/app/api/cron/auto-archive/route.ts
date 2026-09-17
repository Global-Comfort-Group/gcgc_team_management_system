import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { archiveStaleCompletedTasks } from '@/lib/auto-archive'

export const dynamic = 'force-dynamic'

/**
 * Move tasks that have sat in Completed for 5 days to the Backlog. Also runs
 * lazily from GET /api/tasks; this endpoint is for an external scheduler.
 * Same auth as check-overdue: x-cron-secret, fails closed.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const archived = await archiveStaleCompletedTasks()
    return NextResponse.json({ archived })
  } catch (error) {
    console.error('Auto-archive cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
