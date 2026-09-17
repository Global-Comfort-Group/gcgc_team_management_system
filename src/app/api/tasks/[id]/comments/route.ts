import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { parseMentions } from '@/lib/mentions'
import { notifyMention } from '@/lib/notifications'
import { canViewTask } from '@/lib/task-access'

const createCommentSchema = z.object({
  content: z.string().max(500, 'Comment must be 500 characters or fewer').default(''),
  parentId: z.string().optional(),
  imageUrl: z.string().url().optional().nullable(), // Legacy support
  fileUrl: z.string().url().optional().nullable(),
  fileName: z.string().max(255).optional().nullable(),
  fileType: z.string().max(100).optional().nullable(),
  fileSize: z.number().int().positive().optional().nullable(),
}).refine(
  (data) => data.content.trim().length > 0 || data.fileUrl || data.imageUrl,
  { message: 'Comment must have text or an attachment' }
)

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: params.id },
      include: {
        teamMembers: true,
        collaborators: true,
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Only people who can see the task may read its discussion (it can carry
    // attachments). Was open to every signed-in user.
    const { allowed } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get comments with nested structure (parent comments with their replies)
    const comments = await prisma.comment.findMany({
      where: { 
        taskId: params.id,
        parentId: null // Only get parent comments
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        reactions: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          }
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, email: true, image: true }
            },
            reactions: {
              include: {
                user: {
                  select: { id: true, name: true, email: true }
                }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('Get comments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }

    // Check if user has access to this task
    const task = await prisma.task.findUnique({
      where: { id: params.id },
      include: {
        teamMembers: true,
        collaborators: true,
        creator: { select: { id: true, name: true } }
      }
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Anyone who can see the task may join its discussion.
    const { allowed: hasAccess } = await canViewTask(params.id, session.user.id, session.user.role === 'ADMIN')
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { content, parentId, imageUrl, fileUrl, fileName, fileType, fileSize } = createCommentSchema.parse(body)

    // Validate parentId if provided (must be a comment on the same task)
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId }
      })

      if (!parentComment || parentComment.taskId !== params.id) {
        return NextResponse.json({ error: 'Invalid parent comment' }, { status: 400 })
      }
    }

    // Create comment
    const comment = await prisma.comment.create({
      data: {
        content,
        taskId: params.id,
        authorId: session.user.id,
        parentId,
        imageUrl,
        fileUrl,
        fileName,
        fileType,
        fileSize,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        reactions: {
          include: {
            user: {
              select: { id: true, name: true, email: true }
            }
          }
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, email: true, image: true }
            },
            reactions: {
              include: {
                user: {
                  select: { id: true, name: true, email: true }
                }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'COMMENT_ADDED',
        description: `Added comment to task: ${task.title}`,
        userId: session.user.id,
        entityId: params.id,
        entityType: 'task',
        metadata: { commentId: comment.id },
      }
    })

    // Fire @mention notifications (best-effort; never block the response).
    // Candidates are restricted to people with access to the task — a mention of
    // anyone else simply matches nothing, so we never leak a task to a non-member.
    if (content.includes('@')) {
      try {
        const candidateIds = Array.from(new Set(
          [
            task.assigneeId,
            task.creatorId,
            ...(task.teamMembers?.map(tm => tm.userId) ?? []),
            ...(task.collaborators?.map(c => c.userId) ?? []),
          ].filter((id): id is string => !!id && id !== session.user.id)
        ))

        if (candidateIds.length > 0) {
          const candidates = await prisma.user.findMany({
            where: { id: { in: candidateIds } },
            select: { id: true, name: true },
          })
          const mentionedIds = parseMentions(content, candidates)
          const mentionerName = comment.author?.name || 'Someone'
          for (const userId of mentionedIds) {
            void notifyMention(userId, params.id, task.title, mentionerName)
          }
        }
      } catch (mentionError) {
        console.error('Mention notification error:', mentionError)
      }
    }

    return NextResponse.json(comment)
  } catch (error) {
    console.error('Create comment error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input data', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}