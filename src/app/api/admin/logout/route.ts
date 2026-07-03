import { NextRequest, NextResponse } from 'next/server'
import { AdminActionType } from '@prisma/client'
import { getAdminSession } from '@/lib/auth/get-admin-session'
import { logAdminAction } from '@/lib/admin-audit'

export async function POST(request: NextRequest) {
  const session = await getAdminSession(request)

  if (session?.isAdmin) {
    await logAdminAction({
      request,
      action: AdminActionType.ADMIN_LOGOUT,
      description: 'Admin logged out',
      adminId: session.sub,
      adminUsername: session.username,
    })
  }

  const response = NextResponse.json({ success: true })

  // Clear admin session cookie
  response.cookies.set('admin-session', '', {
    httpOnly: true,
    // Must match the login cookie's flags or the browser won't clear it.
    secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https'),
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  })

  return response
}
