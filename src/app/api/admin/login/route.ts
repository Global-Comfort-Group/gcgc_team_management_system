import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { AdminActionType, AdminActionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SignJWT } from 'jose'
import { rateLimit, clearRateLimit, getClientIp } from '@/lib/rate-limit'
import { logAdminAction } from '@/lib/admin-audit'

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)

const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rlKey = `admin-login:${ip}`
    const rl = rateLimit(rlKey, LOGIN_RATE_LIMIT)

    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSeconds) },
        }
      )
    }

    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    // Find admin user
    const admin = await prisma.admin.findUnique({
      where: { username }
    })

    if (!admin || !admin.password) {
      await logAdminAction({
        request,
        action: AdminActionType.ADMIN_LOGIN_FAILED,
        description: 'Login failed: unknown username',
        adminUsername: username,
        status: AdminActionStatus.FAILURE,
      })
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.password)

    if (!isPasswordValid) {
      await logAdminAction({
        request,
        action: AdminActionType.ADMIN_LOGIN_FAILED,
        description: 'Login failed: invalid password',
        adminId: admin.id,
        adminUsername: admin.username,
        status: AdminActionStatus.FAILURE,
      })
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    if (!admin.isActive) {
      await logAdminAction({
        request,
        action: AdminActionType.ADMIN_LOGIN_FAILED,
        description: 'Login failed: account deactivated',
        adminId: admin.id,
        adminUsername: admin.username,
        status: AdminActionStatus.FAILURE,
      })
      return NextResponse.json(
        { error: 'Account is deactivated' },
        { status: 401 }
      )
    }

    // Successful auth — reset the IP bucket so a legitimate admin who mistyped
    // a few times isn't locked out for the rest of the window.
    clearRateLimit(rlKey)

    await logAdminAction({
      request,
      action: AdminActionType.ADMIN_LOGIN,
      description: 'Admin logged in',
      adminId: admin.id,
      adminUsername: admin.username,
    })

    // Create JWT token
    const token = await new SignJWT({
      sub: admin.id,
      username: admin.username,
      isAdmin: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (8 * 60 * 60), // 8 hours
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret)

    // Create response with admin session cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: admin.id,
        username: admin.username,
        isAdmin: true
      }
    })

    // Set admin session cookie
    response.cookies.set('admin-session', token, {
      httpOnly: true,
      // Match the deployment scheme (like NextAuth): a Secure cookie served
      // over plain HTTP is silently dropped by browsers, breaking admin login.
      secure: (process.env.NEXTAUTH_URL ?? '').startsWith('https'),
      sameSite: 'lax',
      maxAge: 8 * 60 * 60, // 8 hours
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Admin login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
