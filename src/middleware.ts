import { NextResponse, NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { UserRole } from '@prisma/client'
import { getCorsHeaders } from '@/lib/cors'
import { verifyAdminSession } from '@/lib/auth/admin-session'

async function adminMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  
  // Allow admin login/logout/session APIs without any authentication
  if (pathname.startsWith('/api/admin/login') || pathname.startsWith('/api/admin/logout') || pathname.startsWith('/api/admin/session')) {
    return NextResponse.next()
  }
  
  // Allow admin login page
  if (pathname === '/administrator/login') {
    return NextResponse.next()
  }
  
  // Protect admin routes
  if (pathname.startsWith('/admin')) {
    const isAdminAuthenticated = await verifyAdminSession(req)
    if (!isAdminAuthenticated) {
      return NextResponse.redirect(new URL('/administrator/login', req.url))
    }
    return NextResponse.next()
  }
  
  // Protect admin API routes (except login/logout)
  if (pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')) {
    const isAdminAuthenticated = await verifyAdminSession(req)
    if (!isAdminAuthenticated) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      )
    }
    return NextResponse.next()
  }
  
  return null // Continue to custom middleware
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Handle CORS preflight requests (OPTIONS) for API v1 routes
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/v1')) {
    const corsHeaders = getCorsHeaders(req)
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  // Allow other CORS preflight requests (OPTIONS) to pass through
  if (req.method === 'OPTIONS') {
    return NextResponse.next()
  }
  
  // First check if this is an admin-related request
  const adminResult = await adminMiddleware(req)
  if (adminResult) {
    return adminResult
  }
  
  // Allow access to public pages
  if (
    pathname === '/' ||
    pathname.startsWith('/auth') ||
    pathname === '/register' ||
    pathname === '/administrator/login' ||
    pathname === '/privacy-policy' ||
    pathname === '/terms-of-service' ||
    pathname === '/sw.js' || // service worker must be served directly (web push)
    /\.(?:png|jpe?g|gif|svg|ico|webp|avif|json|txt|woff2?|ttf|map)$/i.test(pathname) || // static assets (notification icon, manifest, fonts) — fetched without a session
    pathname.startsWith('/google') || // Google Search Console verification
    pathname.startsWith('/forms/') // public intake forms (login-less; token-scoped)
  ) {
    return NextResponse.next()
  }
  
  // Allow public API routes needed for registration without authentication
  const publicApiRoutes = [
    '/api/auth',
    '/api/cron', // Cron jobs — protected by x-cron-secret header (fails closed), not session
    '/api/v1/auth/login', // Server-to-server authentication for TMS
    '/api/organizational-units',
    '/api/job-levels',
    '/api/section-heads',
    '/api/sector-heads',
    '/api/teams-data',
    '/api/users/leaders'
  ]
  const isPublicApiRoute = publicApiRoutes.some(route =>
    pathname.startsWith(route)
  )

  if (isPublicApiRoute) {
    return NextResponse.next()
  }

  // Check for API Key authentication (server-to-server from TMS Server)
  const apiKey = req.headers.get('x-api-key')
  const validApiKey = process.env.API_KEY
  const hasValidApiKey = apiKey && validApiKey && apiKey === validApiKey

  // Allow API Key authenticated requests to bypass NextAuth session check
  if (hasValidApiKey) {
    return NextResponse.next()
  }

  // Non-admin API routes enforce their own auth INSIDE the handler (via
  // getRequestSession, which accepts either the NextAuth session cookie OR an
  // `Authorization: Bearer <token>` from mobile/API clients) and must return JSON.
  // Let them pass through — never redirect an API request to the HTML login page, or
  // bearer-token clients (which have no cookie) get an HTML 200 instead of their data
  // / a JSON 401.
  if (pathname.startsWith('/api') && !pathname.startsWith('/api/admin')) {
    return NextResponse.next()
  }

  // Get the NextAuth token for user authentication
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  // Redirect unauthenticated users to login (for regular user routes)
  if (!token) {
    const signInUrl = new URL('/auth/signin', req.url)
    signInUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(signInUrl)
  }
  
  const userRole = token.role as UserRole
  
  // User portal access control
  if (pathname.startsWith('/user')) {
    // Hidden features — redirect to dashboard until re-enabled
    const hiddenRoutes = ['/user/ossb', '/user/workload']
    // Evaluations is open to everyone (field reports 2026-09): leaders review a
    // member's grades, and a member reads their own. The page and the API both
    // scope a MEMBER to evaluations where they are the evaluatee.
    if (hiddenRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))) {
      return NextResponse.redirect(new URL('/user/dashboard', req.url))
    }
    // Allow all authenticated users to access user portal
    return NextResponse.next()
  }
  
  // API routes protection (non-admin)
  if (pathname.startsWith('/api') && !pathname.startsWith('/api/admin')) {
    // Protected API routes (require authentication)
    const protectedApiRoutes = ['/api/tasks', '/api/teams', '/api/users', '/api/events']
    const isProtectedApiRoute = protectedApiRoutes.some(route => 
      pathname.startsWith(route)
    )
    
    if (isProtectedApiRoute && !token) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401 }
      )
    }
    
    return NextResponse.next()
  }
  
  // Default redirect based on role
  if (pathname === '/') {
    if (userRole) {
      return NextResponse.redirect(new URL('/user/dashboard', req.url))
    }
  }

  // Add CORS headers to all /api/v1/* responses
  const response = NextResponse.next()
  if (pathname.startsWith('/api/v1')) {
    const corsHeaders = getCorsHeaders(req)
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - uploads (user uploaded files like profile images)
     */
    '/((?!_next/static|_next/image|favicon.ico|public/|uploads/).*)',
  ],
}