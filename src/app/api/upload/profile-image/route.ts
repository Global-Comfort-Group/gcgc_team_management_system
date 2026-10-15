import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { saveFile, deleteFile, keyFromLink, safeExtension } from '@/lib/storage'

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({
        error: 'Invalid file type. Only images are allowed.'
      }, { status: 400 })
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: 'File too large. Maximum size is 2MB.'
      }, { status: 400 })
    }

    // Get current user's profile image for cleanup
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true }
    })

    // Generate unique filename
    const timestamp = Date.now()
    const extension = safeExtension(file.name)
    const objectKey = `profiles/${session.user.id}-${timestamp}.${extension}`

    // Store it (local disk or OSS, per STORAGE_BACKEND); imageUrl is the permanent /api/files link
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const { url: imageUrl } = await saveFile(objectKey, buffer, file.type)

    // Update user's profile image in database
    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: imageUrl }
    })

    // Clean up the old profile image if it is one of our stored files
    if (currentUser?.image) {
      const oldObjectKey = keyFromLink(currentUser.image)
      if (oldObjectKey && oldObjectKey !== objectKey) {
        await deleteFile(oldObjectKey)
      }
    }

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'TASK_UPDATED', // We don't have a USER_UPDATED type, so use generic
        description: 'Updated profile picture',
        userId: session.user.id,
        entityId: session.user.id,
        entityType: 'user',
        metadata: { imageUrl }
      }
    })

    return NextResponse.json({
      imageUrl,
      objectKey,
      size: file.size,
      type: file.type,
      message: 'Profile picture updated successfully'
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Profile image upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload profile picture' },
      { status: 500 }
    )
  }
}
