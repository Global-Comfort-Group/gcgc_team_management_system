import { NextRequest, NextResponse } from 'next/server'
import { allocateTicketNumber } from '@/lib/ticket-allocate'
import { prisma } from '@/lib/prisma'
import { getNextOccurrenceDate } from '@/lib/recurring'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'

// Secret to protect the endpoint from public access. Set CRON_SECRET in the
// environment and pass it via the `x-cron-secret` header. Fails CLOSED: an
// unset CRON_SECRET rejects all callers (never public).
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (!isAuthorizedCronRequest(secret, CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const now = new Date()
    // A task is only overdue if its due date is strictly before today (not just before now).
    // Recurring instances are stored at midnight local time, so comparing with "now"
    // during the same day would incorrectly flag them as overdue.
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    // Overdue *recurring instances* only — this job no longer sends overdue or
    // deadline notifications (all user notifications are event-driven now). Its
    // sole purpose is to advance recurring series, which is genuinely time-based
    // and has no user action to hang off of.
    const overdueTasks = await prisma.task.findMany({
      where: {
        isRecurring: false, // skip template tasks
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        dueDate: { lt: startOfToday },
        assigneeId: { not: null },
        recurringParentId: { not: null },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        assigneeId: true,
        recurringParentId: true,
      },
    })

    let recurringAdvanced = 0
    let recurringSkipped = 0

    for (const task of overdueTasks) {
      if (!task.assigneeId || !task.dueDate) continue

      // --- Auto-advance overdue recurring instances ---
      // If this is a recurring instance that wasn't completed, spawn the next
      // occurrence so the series continues regardless of completion status.
      if (task.recurringParentId) {
        try {
          const template = await prisma.task.findUnique({
            where: { id: task.recurringParentId },
            include: { teamMembers: true, collaborators: true },
          })

          if (
            template?.recurringFrequency &&
            template?.startDate
          ) {
            const nextDate = getNextOccurrenceDate(
              template.startDate,
              template.recurringEndDate ?? null,
              template.recurringFrequency,
              template.recurringInterval ?? 1,
              (template.recurringDaysOfWeek as number[]) ?? [],
              task.dueDate
            )

            if (nextDate && (!template.recurringEndDate || nextDate <= template.recurringEndDate)) {
              // Idempotency guard: skip if this occurrence already exists
              const nextMidnight = new Date(nextDate)
              nextMidnight.setHours(0, 0, 0, 0)
              const alreadyExists = await prisma.task.findFirst({
                where: {
                  recurringParentId: template.id,
                  dueDate: {
                    gte: nextMidnight,
                    lt: new Date(nextMidnight.getTime() + 24 * 60 * 60 * 1000),
                  },
                },
              })

              if (!alreadyExists) {
                const newInst = await prisma.task.create({
                  data: {
                    ticketNumber: await allocateTicketNumber(prisma, null),
                    title: template.title,
                    description: template.description,
                    priority: template.priority,
                    status: 'TODO',
                    progressPercentage: 0,
                    taskType: template.taskType,
                    dueDate: nextDate,
                    startDate: nextDate,
                    assigneeId: template.assigneeId,
                    creatorId: template.creatorId,
                    teamId: null,
                    assignedById: template.assignedById,
                    location: template.location,
                    meetingLink: template.meetingLink,
                    allDay: template.allDay,
                    recurrence: template.recurrence,
                    isRecurring: false,
                    recurringParentId: template.id,
                  },
                })

                if (template.taskType === 'TEAM' && template.teamMembers.length > 0) {
                  await prisma.taskTeamMember.createMany({
                    data: template.teamMembers.map(tm => ({
                      taskId: newInst.id,
                      userId: tm.userId,
                      role: 'MEMBER' as const,
                    })),
                  })
                }
                if (template.taskType === 'COLLABORATION' && template.collaborators.length > 0) {
                  await prisma.taskCollaborator.createMany({
                    data: template.collaborators.map(c => ({
                      taskId: newInst.id,
                      userId: c.userId,
                    })),
                  })
                }

                // Copy subtasks from the overdue instance so they recur too
                const sourceSubtasks = await prisma.task.findMany({
                  where: { parentId: task.id },
                  select: {
                    title: true, description: true, priority: true, taskType: true,
                    assigneeId: true, creatorId: true, assignedById: true,
                  },
                })
                if (sourceSubtasks.length > 0) {
                  await prisma.task.createMany({
                    data: sourceSubtasks.map(st => ({
                      title: st.title,
                      description: st.description ?? null,
                      priority: st.priority,
                      status: 'TODO' as const,
                      progressPercentage: 0,
                      taskType: st.taskType,
                      assigneeId: st.assigneeId,
                      creatorId: st.creatorId,
                      assignedById: st.assignedById,
                      dueDate: nextDate,
                      startDate: nextDate,
                      parentId: newInst.id,
                      isRecurring: false,
                    })),
                  })
                }

                // Recurring instances spawn silently — they just appear on the
                // board. No email/notification (a daily recurring task would
                // otherwise email the assignee every single day).

                recurringAdvanced++
              } else {
                recurringSkipped++
              }
            }
          }
        } catch (chainError) {
          console.error(`Error advancing recurring task ${task.id}:`, chainError)
          // Non-fatal — continue with other tasks
        }
      }
    }

    return NextResponse.json({
      checked: overdueTasks.length,
      recurringAdvanced,
      recurringSkipped,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('Overdue check error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
