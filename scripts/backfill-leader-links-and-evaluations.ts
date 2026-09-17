/**
 * Backfill for the 2026-09 field reports. Three independent parts:
 *
 *   1. Team-board members → their board leaders' teams (LeaderMembership).
 *   2. Past task ratings → member evaluations (TaskEvaluation), one per
 *      assignee, dated when the task was rated.
 *   3. Open tasks still waiting for someone to claim them from a role →
 *      assigned to every holder of that role (the new rule).
 *
 * Both are additive and re-runnable: existing links and existing mirrored
 * evaluations are left alone, so an interrupted run resumes cleanly.
 *
 *   npx tsx scripts/backfill-leader-links-and-evaluations.ts            # dry run (default)
 *   npx tsx scripts/backfill-leader-links-and-evaluations.ts --apply    # write
 *
 * Dry-run against a restored copy of production first.
 */
import { PrismaClient } from '@prisma/client'
import { planTeamLeaderLinks } from '../src/lib/team-leader-sync'
import { planTaskEvaluations, applyEvaluationPlan } from '../src/lib/task-evaluation-sync'
import { setTaskAssignees } from '../src/lib/task-assignees'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '— APPLYING —\n' : '— DRY RUN, nothing will be written (pass --apply) —\n')

  // ── 1. Leader links ──────────────────────────────────────────────────────
  const teams = await prisma.team.findMany({
    where: { board: { isNot: null } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  let links = 0
  for (const t of teams) {
    const pairs = await planTeamLeaderLinks(t.id, prisma)
    if (pairs.length === 0) continue
    links += pairs.length
    console.log(`  team "${t.name}": +${pairs.length} leader link(s)`)
    if (APPLY) await prisma.leaderMembership.createMany({ data: pairs, skipDuplicates: true })
  }
  console.log(`leader links ${APPLY ? 'created' : 'to create'}: ${links} across ${teams.length} team board(s)\n`)

  // ── 2. Evaluations ───────────────────────────────────────────────────────
  const rated = await prisma.task.findMany({
    where: { OR: [{ workQuality: { not: null } }, { seniorWorkQuality: { not: null } }] },
    select: { id: true },
  })
  let evals = 0
  let tasksTouched = 0
  const perScore = new Map<number, number>()
  for (const { id } of rated) {
    const plan = await planTaskEvaluations(id, { onlyMissing: true }, prisma)
    if (!plan || plan.create.length === 0) continue
    tasksTouched++
    evals += plan.create.length
    for (const c of plan.create) perScore.set(c.gradientScore, (perScore.get(c.gradientScore) ?? 0) + 1)
    if (APPLY) await applyEvaluationPlan(plan, prisma)
  }
  console.log(`rated tasks: ${rated.length}`)
  console.log(`evaluations ${APPLY ? 'created' : 'to create'}: ${evals} from ${tasksTouched} task(s)`)
  console.log('  by score:', Object.fromEntries(Array.from(perScore.entries()).sort((a, b) => a[0] - b[0])))
  console.log()

  // ── 3. Unclaimed role tasks ──────────────────────────────────────────────
  const unclaimed = await prisma.task.findMany({
    where: {
      assignedRoleId: { not: null },
      assigneeId: null,
      status: { notIn: ['COMPLETED', 'CANCELLED', 'BACKLOG'] },
    },
    select: {
      id: true, title: true, taskType: true,
      assignedRole: { select: { name: true, assignments: { select: { userId: true } } } },
    },
  })
  let assigned = 0
  for (const t of unclaimed) {
    const holders = Array.from(new Set((t.assignedRole?.assignments ?? []).map(a => a.userId)))
    if (holders.length === 0) {
      console.log(`  skip "${t.title}": role "${t.assignedRole?.name}" has no holders`)
      continue
    }
    assigned++
    if (!APPLY) continue
    const team = holders.length > 1 && t.taskType !== 'CASCADING'
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: t.id },
        data: {
          assigneeId: holders[0],
          ...(t.taskType !== 'CASCADING' ? { taskType: team ? 'TEAM' : 'INDIVIDUAL' } : {}),
        },
      })
      if (team) {
        await tx.taskTeamMember.deleteMany({ where: { taskId: t.id } })
        await tx.taskTeamMember.createMany({
          data: holders.slice(1).map(userId => ({ taskId: t.id, userId, role: 'MEMBER' as const })),
          skipDuplicates: true,
        })
      }
      await setTaskAssignees(tx, t.id, holders)
    })
  }
  console.log(`unclaimed role tasks ${APPLY ? 'assigned' : 'to assign'}: ${assigned} of ${unclaimed.length}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
