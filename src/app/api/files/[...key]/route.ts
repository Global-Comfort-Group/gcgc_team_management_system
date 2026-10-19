import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import { getRequestSession } from '@/lib/api-auth'
import { getAdminSession } from '@/lib/auth/admin-session'
import { prisma } from '@/lib/prisma'
import { canViewTask } from '@/lib/task-access'
import { getSignedUrl } from '@/lib/oss'
import { isSafeKey, linkFor, localPath, ossConfigured } from '@/lib/storage'

export const dynamic = 'force-dynamic'

// Served inline: types a browser shows without running anything. Everything else
// (including HTML and SVG, which could run script on TMS's own origin) is sent as a
// download.
const INLINE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
}
const DOWNLOAD: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip',
}

/**
 * Who may open a file. Profile photos: anyone logged in (they appear next to names
 * everywhere). Everything else: whoever may view the task it belongs to - found from
 * the row that links the file, or, for a file uploaded but not yet saved onto a task
 * or comment, from its key. A file nothing links to is visible to its uploader and
 * to admins only.
 */
async function mayOpen(key: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (key.startsWith('profiles/')) return true

  const link = linkFor(key)
  const canView = async (taskId: string) => (await canViewTask(taskId, userId, isAdmin)).allowed

  // Every task that links this file, not just the first: creating a task can copy
  // attachment rows (recurrences, cascade steps), so one file may belong to several
  // tasks, and seeing any one of them is enough.
  const [attachments, comments, procurements] = await Promise.all([
    prisma.taskAttachment.findMany({ where: { fileUrl: link }, select: { taskId: true } }),
    prisma.comment.findMany({ where: { OR: [{ fileUrl: link }, { imageUrl: link }] }, select: { taskId: true } }),
    prisma.taskProcurement.findMany({ where: { OR: [{ fileUrl: link }, { objectKey: key }] }, select: { taskId: true } }),
  ])
  const taskIds = Array.from(new Set([...attachments, ...comments, ...procurements].map((r) => r.taskId)))
  if (taskIds.length) {
    for (const taskId of taskIds) {
      if (await canView(taskId)) return true
    }
    return false
  }

  // Not linked from anything yet: the uploader's own file, picked before saving.
  //   tasks/<uploaderId>/<ts>-<name>
  //   comments/<taskId>/<ts>-<uploaderId>-<name>  or  comments/<taskId>/<ts>-<uploaderId>.<ext>
  if (key.startsWith(`tasks/${userId}/`)) return true
  const c = key.match(/^comments\/([^/]+)\/\d+-([^-./]+)[-.]/)
  if (c && c[2] === userId) return canView(c[1])
  return isAdmin
}

// GET /api/files/<key>
export async function GET(req: NextRequest, { params }: { params: { key: string[] } }) {
  const session = await getRequestSession(req)
  // The admin portal signs in separately (admin-session cookie) and shows avatars;
  // a valid admin-portal session may open any file, as a web ADMIN can.
  const portalAdmin = session?.user?.id ? null : await getAdminSession(req)
  if (!session?.user?.id && !portalAdmin?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = (params.key || []).join('/')
  // Not found rather than forbidden, so a guessed key reveals nothing.
  const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSafeKey(key)) return notFound()

  if (session?.user?.id) {
    try {
      if (!(await mayOpen(key, session.user.id, session.user.role === 'ADMIN'))) return notFound()
    } catch (error) {
      console.error('File access check failed:', key, error)
      return NextResponse.json({ error: 'Failed to open file' }, { status: 500 })
    }
  }

  const ext = (key.split('.').pop() || '').toLowerCase()
  const name = key.split('/').pop() || 'file'
  const inline = ext in INLINE
  const headers: Record<string, string> = {
    'Content-Type': INLINE[ext] || DOWNLOAD[ext] || 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  }
  if (ext !== 'pdf') headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"

  try {
    const p = localPath(key)
    const st = await stat(p)
    if (st.isFile()) {
      headers['Content-Length'] = String(st.size)
      const body = Readable.toWeb(createReadStream(p)) as unknown as ReadableStream
      return new NextResponse(body, { status: 200, headers })
    }
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.error('Error reading local file:', key, e?.message)
      return NextResponse.json({ error: 'Failed to open file' }, { status: 500 })
    }
  }

  // Not on disk (yet): a file from before the move that the startup copy has not
  // reached. Hand out a short-lived link to the bucket instead.
  if (ossConfigured()) {
    return NextResponse.redirect(getSignedUrl(key, 3600), { status: 302, headers: { 'Cache-Control': 'no-store' } })
  }
  return notFound()
}
