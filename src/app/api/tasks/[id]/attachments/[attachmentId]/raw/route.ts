import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Stream an attachment back with `Content-Disposition: inline` so it can be
 * previewed in the page.
 *
 * Alibaba OSS serves from its default endpoint with
 * `Content-Disposition: attachment` and `x-oss-force-download`, so pointing an
 * `<iframe>` at the OSS URL makes the browser save the file instead of
 * rendering it. An `<img>` is unaffected — it never honours the header — which
 * is why comment images already preview correctly while PDFs do not. This route
 * exists for the cases where the header wins.
 *
 * It is a proxy, not a redirect: a redirect would hand the browser the same OSS
 * URL and the same header, achieving nothing.
 *
 * Access mirrors the attachments route exactly — anyone involved in the task.
 * Serving a file needs the same permission as listing it, and the URL is
 * guessable-adjacent (task id + attachment id), so it cannot be left open.
 */

const PREVIEWABLE = [/^image\//, /^application\/pdf$/, /^text\/plain$/]

async function isInvolved(taskId: string, userId: string, isAdmin: boolean) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      creatorId: true,
      assigneeId: true,
      assignedById: true,
      assignees: { select: { userId: true } },
      teamMembers: { select: { userId: true } },
      collaborators: { select: { userId: true } },
    },
  })
  if (!task) return false
  return (
    isAdmin ||
    task.creatorId === userId ||
    task.assigneeId === userId ||
    task.assignedById === userId ||
    task.assignees.some(a => a.userId === userId) ||
    task.teamMembers.some(m => m.userId === userId) ||
    task.collaborators.some(c => c.userId === userId)
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; attachmentId: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const attachment = await prisma.taskAttachment.findFirst({
    where: { id: params.attachmentId, taskId: params.id },
    select: { fileUrl: true, fileName: true, fileType: true },
  })
  if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await isInvolved(params.id, session.user.id, session.user.role === 'ADMIN'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only stream things a browser can actually display. Proxying arbitrary
  // file types would turn this into an open relay for the OSS bucket without
  // adding any preview capability.
  const type = attachment.fileType || 'application/octet-stream'
  if (!PREVIEWABLE.some(re => re.test(type))) {
    return NextResponse.json({ error: 'This file type cannot be previewed.' }, { status: 415 })
  }

  try {
    const upstream = await fetch(attachment.fileUrl)
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Could not fetch the file.' }, { status: 502 })
    }

    // Stream rather than buffer: attachments can be large and there is no
    // reason to hold one in memory to hand it straight on.
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        // The whole point of this route.
        'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
        // Private: the response is permission-checked per user, so a shared
        // cache must never reuse it for someone else.
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Attachment proxy error:', error)
    return NextResponse.json({ error: 'Could not fetch the file.' }, { status: 502 })
  }
}
