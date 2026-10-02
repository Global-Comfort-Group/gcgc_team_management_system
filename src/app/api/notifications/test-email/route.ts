// Sends a test email to the current user so they (or an admin) can confirm
// email delivery works end-to-end — the email twin of /api/push/test. Reports
// the real reason when it doesn't: no API key on the server, or Resend
// rejecting the sender.
import { NextRequest, NextResponse } from 'next/server'
import { getRequestSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { sendNotificationEmail, EmailNotConfiguredError } from '@/lib/email'

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } })
  if (!user?.email) return NextResponse.json({ error: 'Your account has no email address.' }, { status: 400 })

  try {
    await sendNotificationEmail(user.email, {
      title: 'Test email',
      message: 'Email notifications are working. You will get an email like this for each notification in the app.',
      url: process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL}/user/notifications` : undefined,
    })
    return NextResponse.json({ sentTo: user.email })
  } catch (e: any) {
    const status = e instanceof EmailNotConfiguredError ? 503 : 502
    console.error('[test-email]', e?.message || e)
    return NextResponse.json({ error: e?.message || 'Could not send the test email.' }, { status })
  }
}
