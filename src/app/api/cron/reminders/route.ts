import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { sendDueReminders } from '@/lib/task-reminders'

export const dynamic = 'force-dynamic'

// Sends task deadline reminders that have come due. Called every few minutes
// by server.js with a secret it generates at startup (INTERNAL_CRON_SECRET), so
// it runs on the box with no external scheduler. CRON_SECRET also works for a
// manual or external trigger. Fails closed when neither matches.
export async function GET(req: NextRequest) {
  const provided = req.headers.get('x-cron-secret')
  const ok =
    isAuthorizedCronRequest(provided, process.env.INTERNAL_CRON_SECRET) ||
    isAuthorizedCronRequest(provided, process.env.CRON_SECRET)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const sent = await sendDueReminders(prisma)
    return NextResponse.json({ sent })
  } catch (error) {
    console.error('[reminders] run failed:', error)
    return NextResponse.json({ error: 'Reminder run failed' }, { status: 500 })
  }
}
