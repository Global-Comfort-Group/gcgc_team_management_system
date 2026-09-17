import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewTask } from '@/lib/task-access'

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
 * Access is canViewTask (src/lib/task-access.ts) — the same rule as listing
 * the attachments. The URL is guessable-adjacent, so it is never left open.
 */

// Exactly what isPreviewable() in src/lib/attachment-preview.ts offers. Keeping
// a wider allowance here would mean proxying files no UI can ever show, which
// is surface area with no benefit.
const PREVIEWABLE = [/^image\//, /^application\/pdf$/]


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

  // Anyone who can see the task may preview its files. This was limited to
  // people directly on the task, so board members opening a teammate's card got
  // "Error: Forbidden" in the preview (field report 2026-09).
  const { allowed } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
  if (!allowed) {
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
