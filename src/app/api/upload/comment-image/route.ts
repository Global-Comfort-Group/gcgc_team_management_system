import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveFile, safeExtension } from '@/lib/storage'

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    const taskId = formData.get('taskId') as string

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID required' }, { status: 400 })
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
        error: 'File too large. Maximum size is 5MB.'
      }, { status: 400 })
    }

    // Generate unique filename for OSS
    const timestamp = Date.now()
    const extension = safeExtension(file.name)
    const objectKey = `comments/${taskId}/${timestamp}-${session.user.id}.${extension}`

    // Store it (local disk or OSS, per STORAGE_BACKEND); imageUrl is the permanent /api/files link
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const { url: imageUrl } = await saveFile(objectKey, buffer, file.type)

    return NextResponse.json({
      imageUrl,
      objectKey,
      size: file.size,
      type: file.type
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Comment image upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    )
  }
}
