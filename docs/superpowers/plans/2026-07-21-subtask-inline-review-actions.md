# Subtask Inline Review Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a Main task's Subtasks list, let a leader (1) rate a subtask's Work Quality inline to complete it in one gesture, and (2) double-click a subtask to get an Edit/Delete menu, restricted to the creator or a leader on the parent's board.

**Architecture:** Almost entirely frontend in `src/components/tasks/TaskViewModal.tsx`. A subtask is itself a `Task`, so the existing `PATCH`/`DELETE /api/tasks/[id]` endpoints already carry the data (`workQuality`, `creatorId`, `status`) and enforce permission. One backend change: the DELETE route's subtask authorization (fix a pre-existing arg bug + honor "leader on the parent's board", since modal-created subtasks have `teamId=null`/`boardId=null`). The one piece of pure logic (the delete predicate) gets a vitest unit test, matching this repo's convention (17 `src/lib/*.test.ts`, no component tests).

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Prisma, vitest, TailwindCSS. Verification: `npm run type-check` + `npm run test` (vitest) + Playwright E2E.

## Global Constraints

- **Type-check baseline is 197 errors on `main`** (next.config ignores build errors). "No new errors" = total stays 197. Verify with `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`.
- **No Co-Authored-By trailer** in commit messages.
- **No schema/migration changes** — every field already exists (`Task.workQuality`, `Task.creatorId`, `Task.parentId`).
- **Work Quality scale (verbatim from existing parent rater):** `NONE`=label "1"/gray, `POOR`="2"/red, `FAIR`="3"/yellow, `GOOD`="4"/blue, `EXCELLENT`="5"/green. Colors: `bg-gray-400`, `bg-red-400`, `bg-yellow-400`, `bg-blue-400`, `bg-green-500`.
- **Feature scope:** rating applies to any not-completed subtask (TODO/IN_PROGRESS/IN_REVIEW). Cascade steps (`cascadeOrder != null`) and the parent task's own Work Quality section are untouched.
- **Local run for Playwright:** `PORT=3100 NEXTAUTH_URL=http://localhost:3100 npm run dev`. If all routes 404, `rm -rf app` (stray empty dir) and clear `.next`. User portal login `/auth/signin`: `leader1@globalcomfortgroup.com` / `Test1234!`. Dev server is slow (first-compile can hit 60s); re-`browser_resize` after each navigate.

---

## File Structure

- `src/lib/permissions.ts` — **Modify.** Add pure predicate `canManageSubtask(...)`. Home of existing `canDeleteTask`.
- `src/lib/permissions.test.ts` — **Create.** Vitest unit tests for `canManageSubtask` (there is no existing `permissions.test.ts`; `team-permissions.test.ts` exists but covers a different module).
- `src/app/api/tasks/[id]/route.ts` — **Modify.** DELETE handler: fix `canDeleteTask` call args; add parent-board leader authorization for subtasks using `resolveCanRateWorkQuality` + `canManageSubtask`.
- `src/components/tasks/TaskViewModal.tsx` — **Modify.** Hoist `WORK_QUALITIES` const; extend client subtask type (`workQuality`, `creatorId`); Feature A (rate-to-complete picker + score badge + handlers); Feature B (double-click Edit/Delete menu + click disambiguation + delete handler); add `onSubtaskEdit` prop.
- `src/app/user/tasks/page.tsx` — **Modify.** Wire `onSubtaskEdit={handleSubtaskEdit}` (fetch subtask → open TaskForm in edit mode).

---

## Task 1: Backend — subtask delete authorization (pure predicate + route)

**Files:**
- Modify: `src/lib/permissions.ts` (add `canManageSubtask`)
- Create: `src/lib/permissions.test.ts`
- Modify: `src/app/api/tasks/[id]/route.ts` (DELETE handler, ~lines 1117-1172)

**Interfaces:**
- Produces: `canManageSubtask(opts: { isAdmin: boolean; isSubtaskCreator: boolean; isLeaderOnParentBoard: boolean }): boolean`
- Consumes (existing): `resolveCanRateWorkQuality(opts)` from `src/lib/task-rating.ts`; `canDeleteTask(userRole, taskCreatorId, userId, assignedById?, teamMemberRole?)` from `src/lib/permissions.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canManageSubtask } from './permissions'

describe('canManageSubtask', () => {
  it('allows an admin', () => {
    expect(canManageSubtask({ isAdmin: true, isSubtaskCreator: false, isLeaderOnParentBoard: false })).toBe(true)
  })
  it('allows the subtask creator', () => {
    expect(canManageSubtask({ isAdmin: false, isSubtaskCreator: true, isLeaderOnParentBoard: false })).toBe(true)
  })
  it('allows a leader on the parent board', () => {
    expect(canManageSubtask({ isAdmin: false, isSubtaskCreator: false, isLeaderOnParentBoard: true })).toBe(true)
  })
  it('denies an unrelated member', () => {
    expect(canManageSubtask({ isAdmin: false, isSubtaskCreator: false, isLeaderOnParentBoard: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/permissions.test.ts`
Expected: FAIL — `canManageSubtask` is not exported / not a function.

- [ ] **Step 3: Add the predicate**

Append to `src/lib/permissions.ts`:

```ts
/**
 * Who may manage (edit/delete) a subtask from the parent's Subtasks list.
 * "Leader on the parent board" is resolved by the caller via
 * resolveCanRateWorkQuality against the PARENT's board context, because
 * modal-created subtasks carry teamId=null / boardId=null.
 */
export function canManageSubtask(opts: {
  isAdmin: boolean
  isSubtaskCreator: boolean
  isLeaderOnParentBoard: boolean
}): boolean {
  return opts.isAdmin || opts.isSubtaskCreator || opts.isLeaderOnParentBoard
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/permissions.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Extend the DELETE route to fetch parent board context**

In `src/app/api/tasks/[id]/route.ts`, the DELETE handler's `existingTask` query (~line 1132) currently selects `{ id, title, creatorId, teamId, recurringParentId }`. Add `assignedById` and the parent's board context:

```ts
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        creatorId: true,
        assignedById: true,
        teamId: true,
        recurringParentId: true,
        parentId: true,
        parent: {
          select: {
            creatorId: true,
            assigneeId: true,
            boardId: true,
            teamId: true,
            board: { select: { ownerId: true, teamId: true } },
          },
        },
      }
    })
```

- [ ] **Step 6: Fix the arg bug and add parent-board authorization**

Replace the existing permission block (~lines 1160-1172, the `if (!canDeleteTask(...)) return 403`) with:

```ts
    // Check permissions
    if (!session.user.role) {
      return NextResponse.json({ error: 'User role is required' }, { status: 403 })
    }

    // Base rule: admin / creator / assigning-leader / team-leader.
    // (Bug fix: previously teamMember.role was passed into the assignedById
    // slot, so the team-leader branch never received a real role.)
    let allowed = canDeleteTask(
      session.user.role,
      existingTask.creatorId,
      session.user.id,
      existingTask.assignedById ?? undefined,
      teamMember?.role
    )

    // Subtask extension: a leader on the PARENT's board may delete it, even
    // though modal-created subtasks are board-less/team-less themselves.
    if (!allowed && existingTask.parentId && existingTask.parent) {
      const isParentLeader =
        existingTask.parent.creatorId === session.user.id ||
        existingTask.parent.assigneeId === session.user.id
      const isLeaderOnParentBoard = await resolveCanRateWorkQuality({
        canFinalize: session.user.role === 'ADMIN' || isParentLeader,
        isLeader: session.user.role === 'LEADER',
        userId: session.user.id,
        boardId: existingTask.parent.boardId,
        boardOwnerId: existingTask.parent.board?.ownerId ?? null,
        boardTeamId: existingTask.parent.board?.teamId ?? null,
        taskTeamId: existingTask.parent.teamId,
      })
      allowed = canManageSubtask({
        isAdmin: session.user.role === 'ADMIN',
        isSubtaskCreator: existingTask.creatorId === session.user.id,
        isLeaderOnParentBoard,
      })
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
```

- [ ] **Step 7: Add the imports**

Ensure the DELETE route file imports both helpers. `canDeleteTask` is already imported from `@/lib/permissions` (line 6) — add `canManageSubtask` to that import. `resolveCanRateWorkQuality` is already imported from `@/lib/task-rating` (line 10). Update line 6:

```ts
import { canEditTask, canDeleteTask, canManageSubtask, canChangeTaskStatus, canFinalizeTask, isTeamLeader } from '@/lib/permissions'
```

- [ ] **Step 8: Verify test + type-check**

Run: `npm run test -- src/lib/permissions.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `197` (baseline, no new errors).

- [ ] **Step 9: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts "src/app/api/tasks/[id]/route.ts"
git commit -m "feat: authorize subtask delete for parent-board leaders (+ fix canDeleteTask arg bug)"
```

---

## Task 2: Frontend — Feature A: rate-to-complete a subtask inline

**Files:**
- Modify: `src/components/tasks/TaskViewModal.tsx`

**Interfaces:**
- Consumes: `canCompleteTask` (existing derived flag, ~line 1351), `fetchTaskDetails()`, `onTaskUpdate?.()`, `toast`, `localSubtasks`/`setLocalSubtasks`.
- Produces (used by Task 3 render too): module const `WORK_QUALITIES`; state `ratingSubtaskId`; handlers `handleRateAndCompleteSubtask`, `handleChangeSubtaskRating`, `handleReopenSubtask`.

- [ ] **Step 1: Hoist a shared WORK_QUALITIES constant**

Near the top module-level helpers (after `isImageFile`, ~line 246), add:

```ts
const WORK_QUALITIES = [
  { value: 'NONE', label: '1', color: 'bg-gray-400' },
  { value: 'POOR', label: '2', color: 'bg-red-400' },
  { value: 'FAIR', label: '3', color: 'bg-yellow-400' },
  { value: 'GOOD', label: '4', color: 'bg-blue-400' },
  { value: 'EXCELLENT', label: '5', color: 'bg-green-500' },
] as const

const workQualityMeta = (q?: string | null) =>
  WORK_QUALITIES.find(x => x.value === q) ?? null
```

Then in the parent Work Quality section (~line 2688) replace the inline `const qualities = [ ... ]` with `const qualities = WORK_QUALITIES` to DRY (leave the rest of that block unchanged).

- [ ] **Step 2: Extend the client subtask type**

In the `subtasks?: Array<{...}>` type (~lines 136-151), add two fields after `isLocked?: boolean`:

```ts
    workQuality?: 'NONE' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT' | null
    creatorId?: string
```

(GET `/api/tasks/[id]` already returns both — subtasks use `include: { assignee }`, which returns all scalar columns.)

- [ ] **Step 3: Populate the new fields on optimistic add**

In `handleAddSubtask` (~line 841), the optimistic `setLocalSubtasks(prev => [...])` object — add `creatorId: session?.user?.id` and `workQuality: null` so a freshly added subtask is immediately manageable/rateable:

```ts
        setLocalSubtasks(prev => [...(prev || []), {
          id: newTask.id,
          title: newTask.title,
          status: newTask.status,
          priority: newTask.priority,
          progressPercentage: newTask.progressPercentage,
          dueDate: newTask.dueDate,
          assignee: newTask.assignee,
          creatorId: session?.user?.id,
          workQuality: null,
        }])
```

- [ ] **Step 4: Add rating state**

Near the other subtask state (~line 350, after `localSubtasks`):

```ts
  const [ratingSubtaskId, setRatingSubtaskId] = useState<string | null>(null)
```

- [ ] **Step 5: Add the rate/complete/reopen handlers**

After `handleToggleSubtaskCompletion` (~line 939), add:

```ts
  // Shared subtask PATCH with optimistic update + revert on failure.
  const patchSubtaskOptimistic = async (
    subtaskId: string,
    body: Record<string, unknown>,
    optimistic: (s: NonNullable<Task['subtasks']>[number]) => NonNullable<Task['subtasks']>[number],
    successMessage: string,
  ) => {
    const prev = localSubtasks
    setLocalSubtasks(cur => (cur || []).map(s => (s.id === subtaskId ? optimistic(s) : s)))
    try {
      const res = await fetch(`/api/tasks/${subtaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('patch failed')
      toast({ title: successMessage })
      onTaskUpdate?.()
      fetchTaskDetails()
    } catch {
      setLocalSubtasks(prev)
      toast({ title: 'Error', description: 'Failed to update subtask. Please try again.', variant: 'destructive' })
    }
  }

  // Leader rates a not-completed subtask -> saves rating AND completes it.
  const handleRateAndCompleteSubtask = (subtaskId: string, quality: string) => {
    setRatingSubtaskId(null)
    patchSubtaskOptimistic(
      subtaskId,
      { workQuality: quality, status: 'COMPLETED', progressPercentage: 100 },
      s => ({ ...s, status: 'COMPLETED', progressPercentage: 100, workQuality: quality as typeof s.workQuality }),
      `Reviewed · ${quality.toLowerCase()}`,
    )
  }

  // Leader changes the rating on an already-completed subtask (no status change).
  const handleChangeSubtaskRating = (subtaskId: string, quality: string) => {
    setRatingSubtaskId(null)
    patchSubtaskOptimistic(
      subtaskId,
      { workQuality: quality },
      s => ({ ...s, workQuality: quality as typeof s.workQuality }),
      `Rating updated · ${quality.toLowerCase()}`,
    )
  }

  // Leader reopens a completed subtask back to TODO.
  const handleReopenSubtask = (subtaskId: string) => {
    patchSubtaskOptimistic(
      subtaskId,
      { status: 'TODO', progressPercentage: 0 },
      s => ({ ...s, status: 'TODO', progressPercentage: 0 }),
      'Subtask reopened',
    )
  }
```

- [ ] **Step 6: Route the status-circle click through the rating gate**

In the subtask row render, the non-cascade status button (~lines 2541-2554) currently calls `handleToggleSubtaskCompletion(subtask)`. Replace its `onClick` body with a leader-aware branch:

```tsx
                            onClick={(e) => {
                              e.stopPropagation()
                              if (canCompleteTask) {
                                if (subtask.status === 'COMPLETED') {
                                  handleReopenSubtask(subtask.id)
                                } else {
                                  setRatingSubtaskId(prev => (prev === subtask.id ? null : subtask.id))
                                }
                              } else {
                                handleToggleSubtaskCompletion(subtask)
                              }
                            }}
```

(Members — `!canCompleteTask` — keep the existing submit-for-review toggle. `handleToggleSubtaskCompletion` stays as-is for them.)

- [ ] **Step 7: Render the inline picker + completed score badge**

Inside the subtask row, in the details column right after the priority/due `<div className="flex items-center gap-2 mt-1">…</div>` block (~line 2581, before its closing `</div>` of the `flex-1` column), add:

```tsx
                          {/* Completed subtask: show its score, click to change */}
                          {canCompleteTask && subtask.status === 'COMPLETED' && ratingSubtaskId !== subtask.id && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setRatingSubtaskId(subtask.id) }}
                              className="mt-1 inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
                              title="Change work quality"
                            >
                              <span className={`inline-block w-3 h-3 rounded-full ${workQualityMeta(subtask.workQuality)?.color ?? 'bg-gray-200'}`} />
                              <span className="capitalize">{subtask.workQuality ? subtask.workQuality.toLowerCase() : 'rate'}</span>
                            </button>
                          )}
                          {/* Inline Work Quality picker */}
                          {canCompleteTask && ratingSubtaskId === subtask.id && (
                            <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <span className="text-xs text-gray-500 mr-1">Rate to complete:</span>
                              {WORK_QUALITIES.map(q => (
                                <button
                                  key={q.value}
                                  type="button"
                                  onClick={() =>
                                    subtask.status === 'COMPLETED'
                                      ? handleChangeSubtaskRating(subtask.id, q.value)
                                      : handleRateAndCompleteSubtask(subtask.id, q.value)
                                  }
                                  className={`w-7 h-7 rounded-full text-xs font-semibold text-white transition-all border-2 ${subtask.workQuality === q.value ? 'border-gray-800 scale-110' : 'border-transparent opacity-80 hover:opacity-100'} ${q.color}`}
                                  title={q.value}
                                >{q.label}</button>
                              ))}
                              <button
                                type="button"
                                onClick={() => setRatingSubtaskId(null)}
                                className="ml-1 text-gray-400 hover:text-gray-600 text-sm"
                                title="Cancel"
                              >✕</button>
                            </div>
                          )}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `197` (no new errors).
Also confirm no new errors specifically in the file:
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "TaskViewModal" || echo "none"`
Expected: `none`.

- [ ] **Step 9: Commit**

```bash
git add src/components/tasks/TaskViewModal.tsx
git commit -m "feat: rate-to-complete subtasks inline from the parent task"
```

---

## Task 3: Frontend — Feature B: double-click Edit/Delete menu

**Files:**
- Modify: `src/components/tasks/TaskViewModal.tsx`
- Modify: `src/app/user/tasks/page.tsx`

**Interfaces:**
- Consumes: `canRateWork` (existing, ~line 1358), `session`, `onSubtaskClick`, `localSubtasks`, `toast`, `fetchTaskDetails`, `onTaskUpdate`, subtask `creatorId` (added in Task 2).
- Produces: new prop `onSubtaskEdit?: (subtaskId: string) => void`; state `menuSubtaskId`; handlers `handleSubtaskRowClick`, `handleSubtaskRowDoubleClick`, `handleEditSubtask`, `handleDeleteSubtask`; helper `canManageSubtaskRow`.

- [ ] **Step 1: Add the `onSubtaskEdit` prop**

In the props interface, next to `onSubtaskClick?: (subtaskId: string) => void` (~line 229):

```ts
  onSubtaskEdit?: (subtaskId: string) => void
```

And in the destructured params (~line 299, next to `onSubtaskClick,`):

```ts
  onSubtaskEdit,
```

- [ ] **Step 2: Add menu state and a click-timer ref**

Near the subtask state (~line 350):

```ts
  const [menuSubtaskId, setMenuSubtaskId] = useState<string | null>(null)
  const subtaskClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
```

(`useRef` is already imported — it's used elsewhere in the file. Confirm; if not, add it to the React import.)

- [ ] **Step 3: Add the row click/double-click + manage handlers**

After the handlers from Task 2 (~after `handleReopenSubtask`), add:

```ts
  // A viewer may manage (edit/delete) a subtask if they can rate on this
  // board (leader/owner/admin) or they created the subtask. Server enforces.
  const canManageSubtaskRow = (subtask: NonNullable<Task['subtasks']>[number]) =>
    session?.user?.role === 'ADMIN' ||
    canRateWork ||
    (!!subtask.creatorId && subtask.creatorId === session?.user?.id)

  // Single click opens the subtask, but hold ~250ms so a double-click can
  // cancel the open and show the Edit/Delete menu instead.
  const handleSubtaskRowClick = (subtask: NonNullable<Task['subtasks']>[number]) => {
    if (subtask.isLocked) return
    if (subtaskClickTimer.current) return // second click of a double-click
    subtaskClickTimer.current = setTimeout(() => {
      subtaskClickTimer.current = null
      onSubtaskClick?.(subtask.id)
    }, 250)
  }

  const handleSubtaskRowDoubleClick = (subtask: NonNullable<Task['subtasks']>[number]) => {
    if (subtaskClickTimer.current) {
      clearTimeout(subtaskClickTimer.current)
      subtaskClickTimer.current = null
    }
    if (subtask.isLocked) return
    if (!canManageSubtaskRow(subtask)) return // others: double-click shows nothing
    setMenuSubtaskId(prev => (prev === subtask.id ? null : subtask.id))
  }

  const handleEditSubtask = (subtaskId: string) => {
    setMenuSubtaskId(null)
    if (onSubtaskEdit) onSubtaskEdit(subtaskId)
    else onSubtaskClick?.(subtaskId) // fallback: open subtask (has its own Edit)
  }

  const handleDeleteSubtask = async (subtaskId: string) => {
    setMenuSubtaskId(null)
    const prev = localSubtasks
    setLocalSubtasks(cur => (cur || []).filter(s => s.id !== subtaskId))
    try {
      const res = await fetch(`/api/tasks/${subtaskId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      toast({ title: 'Subtask deleted' })
      onTaskUpdate?.()
      fetchTaskDetails()
    } catch {
      setLocalSubtasks(prev)
      toast({ title: 'Error', description: 'Failed to delete subtask. Please try again.', variant: 'destructive' })
    }
  }
```

- [ ] **Step 4: Wire the row handlers + make the row a positioning context**

On the subtask row container `<div>` (~lines 2526-2533): add `relative` to className and swap the `onClick`:

```tsx
                      <div
                        key={subtask.id}
                        className={`relative flex items-center gap-3 p-3 rounded-lg transition-colors ${
                          isLocked
                            ? 'bg-slate-50 border border-slate-200 opacity-60'
                            : `bg-gray-50 hover:bg-gray-100 ${onSubtaskClick ? 'cursor-pointer' : ''}`
                        }`}
                        onClick={() => handleSubtaskRowClick(subtask)}
                        onDoubleClick={() => handleSubtaskRowDoubleClick(subtask)}
                      >
```

- [ ] **Step 5: Render the Edit/Delete popover menu**

As the last child inside the row `<div>` (right after the `{!isLocked && <ChevronRight … />}` line, ~line 2597, still inside the row container), add:

```tsx
                        {menuSubtaskId === subtask.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => { e.stopPropagation(); setMenuSubtaskId(null) }}
                            />
                            <div
                              className="absolute right-2 top-2 z-50 min-w-[130px] rounded-md border bg-white py-1 shadow-lg"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
                                onClick={() => handleEditSubtask(subtask.id)}
                              >
                                <Pencil className="h-4 w-4" /> Edit
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                                onClick={() => handleDeleteSubtask(subtask.id)}
                              >
                                <Trash2 className="h-4 w-4" /> Delete
                              </button>
                            </div>
                          </>
                        )}
```

(`Pencil` and `Trash2` are already imported — they're used in the comment dropdown.)

- [ ] **Step 6: Wire `onSubtaskEdit` in the user tasks page**

In `src/app/user/tasks/page.tsx`, add a handler next to `handleSubtaskClick` (~line 1254):

```ts
  const handleSubtaskEdit = async (subtaskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${subtaskId}`)
      if (!res.ok) return
      const subtask = await res.json()
      setEditingTask(subtask)
      setShowTaskForm(true)
    } catch (e) {
      console.error('Failed to open subtask for edit:', e)
    }
  }
```

Then pass it to the modal (~line 2210, next to `onSubtaskClick={handleSubtaskClick}`):

```tsx
        onSubtaskEdit={handleSubtaskEdit}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `197` (no new errors).
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TaskViewModal|user/tasks" || echo "none"`
Expected: `none`.

- [ ] **Step 8: Commit**

```bash
git add src/components/tasks/TaskViewModal.tsx src/app/user/tasks/page.tsx
git commit -m "feat: double-click subtask for Edit/Delete menu (creator/board-leader only)"
```

---

## Task 4: End-to-end verification with Playwright

**Files:** none (verification only). Uses the Claude-in-Chrome / Playwright MCP tools.

**Interfaces:** Consumes the running dev server on `http://localhost:3100`.

- [ ] **Step 1: Start the dev server**

```bash
PORT=3100 NEXTAUTH_URL=http://localhost:3100 npm run dev
```
Run in background. If every route 404s, stop, `rm -rf app && rm -rf .next`, restart. Wait for "ready" and a successful compile of `/auth/signin`.

- [ ] **Step 2: Confirm a usable fixture exists**

As `leader1@globalcomfortgroup.com`, ensure there is a Main task that (a) the leader owns/leads and (b) has at least one subtask in IN_REVIEW (submitted). If none, create a Main task, add a subtask, and — as the assignee — submit it for review (status circle → IN_REVIEW). If seeded logins fail, apply the local fixes from the local-verification-setup memory (email-domain rewrite + set `Test1234!` via a bcrypt `.cjs`). Do NOT alter production data — local seeded DB only.

- [ ] **Step 3: Verify Feature A — rate-to-complete (with screenshots)**

Log in at `/auth/signin` as the leader. Open the Main task. In Subtasks:
1. Click a submitted subtask's status circle → assert the inline "Rate to complete" 1–5 picker appears and the subtask is **not** yet completed. Screenshot.
2. Click score "4" (GOOD) → assert the row flips to Completed (title strikethrough), shows a GOOD score badge, a success toast fires, and the parent "Subtask Progress" advances. Screenshot.
3. Click the GOOD badge → picker reopens; click "5" (EXCELLENT) → assert badge updates and subtask stays Completed. Screenshot.

- [ ] **Step 4: Verify Feature B — Edit/Delete menu (with screenshots)**

1. Double-click a subtask row → assert the Edit/Delete popover appears. Screenshot.
2. Click **Edit** → assert the TaskForm opens in edit mode for that subtask (title pre-filled). Close it.
3. Double-click another subtask → **Delete** → assert the subtask disappears from the list, a "Subtask deleted" toast fires, and the count/progress updates. Screenshot.
4. Re-fetch the parent (reopen the modal) → assert the deleted subtask stays gone (server persisted). Screenshot.

- [ ] **Step 5: Verify the negative permission path**

Log out; log in as a plain **member** who is a subtask assignee but not the creator/leader. Open the same Main task:
1. Assert the status circle still **submits for review** (no rating picker appears).
2. Double-click a subtask → assert **no** Edit/Delete menu appears.
Screenshot each.

- [ ] **Step 6: Final gate + report**

Run: `npm run test -- src/lib/permissions.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"` → `197`.
Summarize results with the screenshots as evidence. If any step fails, STOP and return to `superpowers:systematic-debugging` rather than patching blindly.

---

## Self-Review

**Spec coverage:**
- Feature A rate-to-complete (submitted → picker → complete+rate): Task 2 steps 5-7. ✓
- Rating scale reuse: Task 2 step 1 (`WORK_QUALITIES`). ✓
- Change rating on completed / reopen via circle: Task 2 steps 5-6 (`handleChangeSubtaskRating`, `handleReopenSubtask`). ✓
- Members unaffected: Task 2 step 6 (else-branch keeps `handleToggleSubtaskCompletion`); verified Task 4 step 5. ✓
- Feature B double-click Edit/Delete menu, gated to creator/board-leader/admin: Task 3 steps 3-5. ✓
- Edit → edit modal: Task 3 step 6 (`handleSubtaskEdit`). ✓
- Delete via existing endpoint, deliberate menu step (no extra confirm), optimistic + revert: Task 3 step 3. ✓ (Undo intentionally omitted — a lossless undo would require re-creating the Task; deemed not cheap. Noted in spec.)
- Click disambiguation (single opens, double = menu): Task 3 steps 2-4. ✓
- Backend: arg-bug fix + parent-board leader authorization: Task 1 steps 5-7. ✓
- Cascade steps & parent WQ section untouched: cascade rows use the number badge (no status circle) and are never given the picker; parent section only changed to reference `WORK_QUALITIES`. ✓
- Verification via Playwright + type-check: Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✓

**Type consistency:** `canManageSubtask({isAdmin,isSubtaskCreator,isLeaderOnParentBoard})` — same shape in Task 1 test, definition, and route call. `WORK_QUALITIES`/`workQualityMeta` defined in Task 2 step 1, used in steps 7 and Task 3. `onSubtaskEdit` typed in Task 3 step 1, wired in step 6. `patchSubtaskOptimistic` signature consistent across its three callers. Subtask type gains `workQuality`/`creatorId` (Task 2 step 2) before they're read (Task 2 step 7, Task 3 step 3). ✓

**Assumptions to confirm during execution (fail-safe, not blockers):**
- `useRef` is imported in TaskViewModal (Task 3 step 2 notes to add if missing).
- The exact line anchors (2526, 2581, 2597, 2210, 1254) may drift; match on surrounding code shown, not line numbers.
