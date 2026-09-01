/**
 * Where a duplicated task's child items belong in the create form.
 *
 * A cascading task and an ordinary task both carry their children as
 * `subtasks` on the source record, but the create form holds them in two
 * different places: cascading steps render from `cascadeSteps`, everything else
 * from `pendingSubtasks`. Duplicating a cascading task used to load them into
 * `pendingSubtasks` only — so the form showed no steps, while submit still sent
 * them and the server created them. That is the reported "subtasks don't show
 * during creation but appear once the task is created".
 *
 * Routing to exactly one of the two lists also prevents the opposite failure:
 * populating both would submit the children twice.
 */

export interface PrefillChild {
  id: string
  title: string
  assigneeId: string
  assignee?: { id: string; name?: string; email: string; image?: string }
  dueDate?: string
}

interface SourceSubtask {
  id?: string
  title: string
  assigneeId?: string | null
  assignee?: { id: string; name?: string; email: string; image?: string }
  dueDate?: string | null
  cascadeOrder?: number | null
}

function toPrefillChild(s: SourceSubtask, index: number): PrefillChild {
  return {
    id: `dup-${index}-${s.id ?? s.title}`,
    title: s.title,
    assigneeId: s.assignee?.id ?? s.assigneeId ?? '',
    assignee: s.assignee,
    dueDate: s.dueDate || undefined,
  }
}

/**
 * Split a duplicated task's subtasks into the two lists the form renders from.
 * Exactly one list is ever populated.
 *
 * Cascading steps are ordered by `cascadeOrder` — the order IS the feature, and
 * the API does not guarantee the array comes back sorted. Steps without an
 * order sort last, keeping their relative position.
 */
export function splitDuplicatedChildren(
  subtasks: SourceSubtask[] | undefined | null,
  isCascading: boolean
): { cascadeSteps: PrefillChild[]; pendingSubtasks: PrefillChild[] } {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { cascadeSteps: [], pendingSubtasks: [] }
  }

  if (!isCascading) {
    return { cascadeSteps: [], pendingSubtasks: subtasks.map(toPrefillChild) }
  }

  const ordered = subtasks
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ao = a.s.cascadeOrder ?? Number.MAX_SAFE_INTEGER
      const bo = b.s.cascadeOrder ?? Number.MAX_SAFE_INTEGER
      return ao !== bo ? ao - bo : a.i - b.i
    })
    .map(({ s }, i) => toPrefillChild(s, i))

  return { cascadeSteps: ordered, pendingSubtasks: [] }
}
