import type { Prisma, PrismaClient, WorkQuality } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | PrismaClient

/**
 * Task ratings → member evaluations (field report 2026-09).
 *
 * A leader's 1–5 work-quality rating lived only on the Task row, so the
 * Evaluations page — which reads `TaskEvaluation` — never saw it and leaders
 * could not review a member's grades. This mirrors each rating onto one
 * evaluation per assignee.
 *
 * Rows written here are tagged in `comments` with TAG so they are never
 * confused with (or overwrite) evaluations a leader entered by hand.
 */
export const TASK_RATING_TAG = '[Task rating]'

/** The rater's 1–5 scale onto the evaluation gradient. "1" (NONE) is a real grade. */
export const QUALITY_SCORE: Record<WorkQuality, number> = {
  NONE: 0,
  POOR: 25,
  FAIR: 50,
  GOOD: 75,
  EXCELLENT: 100,
}

export interface EvaluationPlan {
  taskId: string
  create: Array<{ evaluateeId: string; evaluatorId: string; gradientScore: number; evaluatedAt: Date }>
  update: Array<{ id: string; evaluatorId: string; gradientScore: number; evaluatedAt: Date }>
  remove: string[]
}

interface SyncOptions {
  /** Who just set the leader rating (live path). Absent in the backfill. */
  leaderRaterId?: string
  /** Backfill: only add missing rows, never touch existing ones. */
  onlyMissing?: boolean
}

function dayBounds(at: Date) {
  const start = new Date(at); start.setHours(0, 0, 0, 0)
  const end = new Date(at); end.setHours(23, 59, 59, 999)
  return { start, end }
}

export async function planTaskEvaluations(
  taskId: string,
  opts: SyncOptions = {},
  db: Db = defaultPrisma,
): Promise<EvaluationPlan | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true, workQuality: true, seniorWorkQuality: true,
      seniorEvaluatorId: true, seniorEvaluatedAt: true,
      leaderEvaluatedAt: true, updatedAt: true,
      assignedById: true, creatorId: true, assigneeId: true,
      assignees: { select: { userId: true } },
    },
  })
  if (!task) return null

  const existing = await db.taskEvaluation.findMany({
    where: { taskId, comments: { startsWith: TASK_RATING_TAG } },
    select: { id: true, evaluateeId: true, evaluatorId: true },
  })
  const plan: EvaluationPlan = { taskId, create: [], update: [], remove: [] }

  // The senior override, when present, is the grade that counts.
  let score: number | null = null
  let evaluatorId: string | null = null
  let at: Date = new Date()
  if (task.seniorWorkQuality != null) {
    score = QUALITY_SCORE[task.seniorWorkQuality]
    evaluatorId = task.seniorEvaluatorId
    at = task.seniorEvaluatedAt ?? task.updatedAt
  } else if (task.workQuality != null) {
    score = QUALITY_SCORE[task.workQuality]
    // No column records who gave the leader rating. Live, we know; for old
    // ratings the assigner (else creator) is who the rating gate let rate.
    evaluatorId = opts.leaderRaterId ?? task.assignedById ?? task.creatorId
    at = opts.leaderRaterId ? new Date() : (task.leaderEvaluatedAt ?? task.updatedAt)
  }

  // Rating cleared: its mirrored evaluations go too.
  if (score == null || !evaluatorId) {
    if (!opts.onlyMissing) plan.remove = existing.map(e => e.id)
    return plan
  }

  const evaluatees = Array.from(new Set(
    [task.assigneeId, ...task.assignees.map(a => a.userId)].filter((u): u is string => !!u),
  )).filter(u => u !== evaluatorId) // a rating of your own work is not an evaluation

  const byEvaluatee = new Map(existing.map(e => [e.evaluateeId, e]))
  for (const evaluateeId of evaluatees) {
    const row = byEvaluatee.get(evaluateeId)
    if (!row) {
      plan.create.push({ evaluateeId, evaluatorId, gradientScore: score, evaluatedAt: at })
    } else if (!opts.onlyMissing) {
      // Keep the original evaluator when a sync runs without knowing the rater.
      plan.update.push({
        id: row.id,
        evaluatorId: opts.leaderRaterId || task.seniorWorkQuality != null ? evaluatorId : row.evaluatorId,
        gradientScore: score,
        evaluatedAt: at,
      })
    }
  }
  if (!opts.onlyMissing) {
    const keep = new Set(evaluatees)
    plan.remove = existing.filter(e => !keep.has(e.evaluateeId)).map(e => e.id)
  }
  return plan
}

export async function applyEvaluationPlan(plan: EvaluationPlan, db: Db = defaultPrisma): Promise<void> {
  for (const c of plan.create) {
    const { start, end } = dayBounds(c.evaluatedAt)
    await db.taskEvaluation.create({
      data: {
        taskId: plan.taskId,
        evaluateeId: c.evaluateeId,
        evaluatorId: c.evaluatorId,
        gradientScore: c.gradientScore,
        period: 'DAILY',
        evaluatedAt: c.evaluatedAt,
        periodStartDate: start,
        periodEndDate: end,
        comments: TASK_RATING_TAG,
      },
    })
  }
  for (const u of plan.update) {
    const { start, end } = dayBounds(u.evaluatedAt)
    await db.taskEvaluation.update({
      where: { id: u.id },
      data: {
        evaluatorId: u.evaluatorId,
        gradientScore: u.gradientScore,
        evaluatedAt: u.evaluatedAt,
        periodStartDate: start,
        periodEndDate: end,
      },
    })
  }
  if (plan.remove.length > 0) {
    await db.taskEvaluation.deleteMany({ where: { id: { in: plan.remove } } })
  }
}

/** Live path: call after a rating changes. Never throws into the request. */
export async function syncTaskEvaluations(taskId: string, leaderRaterId?: string): Promise<void> {
  try {
    const plan = await planTaskEvaluations(taskId, { leaderRaterId })
    if (plan) await applyEvaluationPlan(plan)
  } catch (e) {
    console.error('Task evaluation sync failed:', e)
  }
}
