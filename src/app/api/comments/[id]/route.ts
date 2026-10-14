import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { deleteFile, keyFromLink } from '@/lib/storage'

const updateCommentSchema = z.object({
  content: z.string().min(1).max(500, 'Comment must be 500 characters or fewer').optional(),
  imageUrl: z.string().nullable().optional(), // Legacy support
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().max(255).nullable().optional(),
  fileType: z.string().max(100).nullable().optional(),
  fileSize: z.number().int().positive().nullable().optional(),
})

// GET - Get a single comment
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const comment = await prisma.comment.findUnique({
      where: { id: params.id },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        reactions: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        },
        replies: {
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            reactions: {
              include: {
                user: { select: { id: true, name: true, email: true } }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    return NextResponse.json(comment)
  } catch (error) {
    console.error('Error fetching comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a comment
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the existing comment
    const existingComment = await prisma.comment.findUnique({
      where: { id: params.id },
      select: { authorId: true, imageUrl: true, fileUrl: true }
    })

    if (!existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Only the author can edit their comment
    if (existingComment.authorId !== session.user.id) {
      return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 })
    }

    const body = await req.json()
    const validatedData = updateCommentSchema.parse(body)

    // Helper function to clean up an old stored file
    const cleanupOldFile = async (oldUrl: string | null, newUrl: string | null | undefined) => {
      if (oldUrl && newUrl !== undefined) {
        // If file is being removed (null) or changed to a different URL
        if (newUrl === null || (newUrl && newUrl !== oldUrl)) {
          const objectKey = keyFromLink(oldUrl)
          if (objectKey) {
            await deleteFile(objectKey)
          }
        }
      }
    }

    // Clean up old files if being changed/removed
    await cleanupOldFile(existingComment.imageUrl, validatedData.imageUrl)
    await cleanupOldFile(existingComment.fileUrl, validatedData.fileUrl)

    // Update the comment
    const updatedComment = await prisma.comment.update({
      where: { id: params.id },
      data: {
        ...(validatedData.content && { content: validatedData.content }),
        ...(validatedData.imageUrl !== undefined && { imageUrl: validatedData.imageUrl }),
        ...(validatedData.fileUrl !== undefined && { fileUrl: validatedData.fileUrl }),
        ...(validatedData.fileName !== undefined && { fileName: validatedData.fileName }),
        ...(validatedData.fileType !== undefined && { fileType: validatedData.fileType }),
        ...(validatedData.fileSize !== undefined && { fileSize: validatedData.fileSize }),
        updatedAt: new Date()
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true }
        },
        reactions: {
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        },
        replies: {
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            reactions: {
              include: {
                user: { select: { id: true, name: true, email: true } }
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    })

    return NextResponse.json(updatedComment)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid data', details: error.errors }, { status: 400 })
    }
    console.error('Error updating comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a comment
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the existing comment
    const existingComment = await prisma.comment.findUnique({
      where: { id: params.id },
      select: {
        authorId: true,
        imageUrl: true,
        fileUrl: true,
        task: {
          select: { creatorId: true }
        }
      }
    })

    if (!existingComment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    // Only the author or task creator or admin can delete the comment
    const isAuthor = existingComment.authorId === session.user.id
    const isTaskCreator = existingComment.task?.creatorId === session.user.id
    const isAdmin = session.user.role === 'ADMIN'

    if (!isAuthor && !isTaskCreator && !isAdmin) {
      return NextResponse.json({ error: 'You do not have permission to delete this comment' }, { status: 403 })
    }

    // Delete stored files if they exist
    const filesToDelete = [existingComment.imageUrl, existingComment.fileUrl].filter(Boolean) as string[]
    for (const fileUrl of filesToDelete) {
      const objectKey = keyFromLink(fileUrl)
      if (objectKey) {
        await deleteFile(objectKey)
      }
    }

    // Delete all replies first (cascade)
    await prisma.comment.deleteMany({
      where: { parentId: params.id }
    })

    // Delete the comment
    await prisma.comment.delete({
      where: { id: params.id }
    })

    return NextResponse.json({ success: true, message: 'Comment deleted successfully' })
  } catch (error) {
    console.error('Error deleting comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
