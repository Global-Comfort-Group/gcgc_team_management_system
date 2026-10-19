import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveFile } from '@/lib/storage'

// Blocked dangerous file extensions
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.dll', '.so',
  '.com', '.msi', '.vbs', '.js', '.jse', '.wsf', '.wsh',
  '.scr', '.pif', '.reg', '.jar', '.app'
]

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

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

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: 'File too large. Maximum size is 50MB.'
      }, { status: 400 })
    }

    // Sanitize filename and check extension
    const originalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const extension = '.' + (originalName.split('.').pop()?.toLowerCase() || '')

    // Block dangerous extensions
    if (BLOCKED_EXTENSIONS.includes(extension)) {
      return NextResponse.json({
        error: 'This file type is not allowed for security reasons.'
      }, { status: 400 })
    }

    // Generate unique filename for OSS
    const timestamp = Date.now()
    const sanitizedName = originalName.substring(0, 100) // Limit filename length
    const objectKey = `comments/${taskId}/${timestamp}-${session.user.id}-${sanitizedName}`

    // Store it (local disk or OSS, per STORAGE_BACKEND); fileUrl is the permanent /api/files link
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const { url: fileUrl } = await saveFile(objectKey, buffer, file.type)

    return NextResponse.json({
      fileUrl,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      objectKey,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Comment file upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}
