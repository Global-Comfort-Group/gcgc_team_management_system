import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { isAllowedEmailDomain, ALLOWED_EMAIL_MESSAGE } from '@/lib/allowed-email-domains'
import { z } from 'zod'

const updateProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  middleName: z.string().optional(),
  contactNumber: z.string().optional(),
  // Login identity — only editable by the account owner or an admin (enforced below).
  email: z.string().trim().email('Please enter a valid email address').optional(),
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(30, 'Username must be 30 characters or fewer').regex(/^[a-zA-Z0-9._-]+$/, 'Username can only contain letters, numbers, and . _ -').optional(),
  positionTitle: z.string().optional(),
  division: z.string().optional(),
  department: z.string().optional(),
  section: z.string().optional(),
  team: z.string().optional(),
  jobLevel: z.string().optional(),
  hierarchyLevel: z.enum(['RF1', 'RF2', 'RF3', 'OF1', 'OF2', 'OF3', 'OF4', 'OF5', 'NR1', 'NR2', 'NR3', 'NR4']).nullable().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Users can only access their own profile unless they're an admin
    if (session.user.id !== params.id && (!session.user.role || session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        middleName: true,
        name: true,
        contactNumber: true,
        image: true,
        role: true,
        hierarchyLevel: true,
        reportsToId: true,
        division: true,
        department: true,
        section: true,
        team: true,
        positionTitle: true,
        shortName: true,
        jobLevel: true,
        organizationalPath: true,
        sectorHeadInitials: true,
        customDivision: true,
        customDepartment: true,
        customSection: true,
        customTeam: true,
        isLeader: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        reportsTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Add cache-control headers to prevent caching of dynamic user data
    return NextResponse.json(user, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization: a user may update their own profile; an admin may update
    // anyone; a leader may update a member of their OWN team (so they can
    // correct org placement when adding/managing them). updateProfileSchema is
    // org/profile-only (no role/email/password/isActive), so a leader cannot
    // escalate privileges — at most they edit a managed member's org info.
    const isSelf = session.user.id === params.id
    const isAdmin = session.user.role === 'ADMIN'
    let isManagedByLeader = false
    if (!isSelf && !isAdmin && session.user.role === 'LEADER') {
      const target = await prisma.user.findUnique({
        where: { id: params.id },
        select: { role: true },
      })
      if (target && target.role !== 'ADMIN') {
        const membership = await prisma.leaderMembership.findUnique({
          where: { leaderId_memberId: { leaderId: session.user.id, memberId: params.id } },
        })
        isManagedByLeader = !!membership
      }
    }
    if (!isSelf && !isAdmin && !isManagedByLeader) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateProfileSchema.parse(body)

    // Login identity may never be changed by a leader editing a managed member,
    // who is limited to org/profile fields and must not be able to take over a
    // member's login. The email address is admin-only — users can't change their
    // own (field reports 2026-09); the username stays self-service.
    if (validatedData.email !== undefined && !isAdmin) {
      const current = await prisma.user.findUnique({ where: { id: params.id }, select: { email: true } })
      if (validatedData.email.toLowerCase() !== current?.email?.toLowerCase()) {
        return NextResponse.json({ error: 'Only an administrator can change an email address' }, { status: 403 })
      }
      delete (validatedData as { email?: string }).email
    }
    if (validatedData.username !== undefined && !isSelf && !isAdmin) {
      return NextResponse.json({ error: 'Only the account owner or an admin can change the username' }, { status: 403 })
    }

    // Email must be from an allowed domain.
    if (validatedData.email !== undefined && !isAllowedEmailDomain(validatedData.email)) {
      return NextResponse.json({ error: ALLOWED_EMAIL_MESSAGE }, { status: 400 })
    }

    // Uniqueness checks (email + username are @unique) — give a clean message
    // instead of a raw Prisma P2002 constraint error.
    if (validatedData.email !== undefined) {
      const taken = await prisma.user.findFirst({
        where: { email: validatedData.email, NOT: { id: params.id } },
        select: { id: true },
      })
      if (taken) return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 })
    }
    if (validatedData.username !== undefined) {
      const taken = await prisma.user.findFirst({
        where: { username: validatedData.username, NOT: { id: params.id } },
        select: { id: true },
      })
      if (taken) return NextResponse.json({ error: 'That username is already taken' }, { status: 409 })
    }

    // Get current user data to compute full name
    let computedName: string | null = null
    if (validatedData.firstName !== undefined || validatedData.lastName !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: params.id },
        select: { firstName: true, lastName: true }
      })

      if (currentUser) {
        const firstName = validatedData.firstName ?? currentUser.firstName ?? ''
        const lastName = validatedData.lastName ?? currentUser.lastName ?? ''
        computedName = [firstName, lastName].filter(Boolean).join(' ') || null
      }
    }

    // Update the user profile
    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...validatedData,
        // Compute the name field if firstName or lastName are provided
        ...(computedName !== null ? { name: computedName } : {}),
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        middleName: true,
        name: true,
        contactNumber: true,
        image: true,
        role: true,
        hierarchyLevel: true,
        reportsToId: true,
        division: true,
        department: true,
        section: true,
        team: true,
        positionTitle: true,
        shortName: true,
        jobLevel: true,
        organizationalPath: true,
        sectorHeadInitials: true,
        customDivision: true,
        customDepartment: true,
        customSection: true,
        customTeam: true,
        isLeader: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        reportsTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })

    return NextResponse.json({ user: updatedUser })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message || 'Invalid data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating user profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
