# Subtask inline review actions (rate-to-complete + double-click Edit/Delete)

**Date:** 2026-07-21
**Branch:** `feat/subtask-inline-review-actions`
**Component:** `src/components/tasks/TaskViewModal.tsx` (Subtasks section), with a small backend permission fix in `src/app/api/tasks/[id]/route.ts`.

## Problem

A Main (parent) task's Subtasks list currently only lets you open each subtask or toggle its status. To review a member's work quality, a leader must open each subtask individually. Leaders want to review/finalize subtasks and manage them (edit/delete) directly from the parent's Subtasks list.

Two features:

- **A. Rate-to-complete** — a leader finalizes a submitted subtask by giving it a Work Quality rating inline; the rating both scores and completes it, in one gesture.
- **B. Double-click Edit/Delete menu** — double-clicking a subtask reveals an Edit/Delete menu, shown only to users allowed to manage that subtask.

Both are almost entirely frontend: a subtask is itself a `Task`, so the existing task APIs already carry the data and enforce the permissions.

## Existing landscape (verified)

- Subtasks are `Task` rows with `parentId`. They already have `workQuality` / `seniorWorkQuality` columns.
- `GET /api/tasks/[id]` returns `subtasks` via `include: { assignee }`, which returns **all** subtask scalar fields — so `workQuality` is already in the payload; the client type just doesn't expose it.
- `PATCH /api/tasks/[subtaskId]`:
  - Computes `isParentLeader` from `parent.{creatorId,assigneeId}` and folds it into `canComplete` (via `canFinalizeTask`) and `canRate` (via `resolveCanRateWorkQuality`).
  - A combined `{ workQuality, status: 'COMPLETED', progressPercentage: 100 }` update by a parent leader **passes**: `canComplete` is true (so the status-change gate and the general-edit gate are satisfied) and `workQuality` is applied because `canRate` is true. Confirmed by reading the route's gate logic.
- `DELETE /api/tasks/[subtaskId]` exists and is gated by `canDeleteTask(userRole, taskCreatorId, userId, assignedById?, teamMemberRole?)`, which allows: admin, task creator, the assigning leader, and a team leader.
- The Subtasks list already branches on `canCompleteTask`: that flag distinguishes a leader (who finalizes: COMPLETED) from a member (who submits: IN_REVIEW). We reuse it as the "show leader affordances" signal.
- `TaskViewModal` already accepts `onEdit?: (task) => void` and `onSubtaskClick?: (subtaskId) => void` props from its parent.

## Feature A — Rate-to-complete a subtask inline

### Interaction

Persona: a viewer with `canCompleteTask` on the parent (leader/creator/owner/admin). Members are unaffected — their status-circle keeps toggling submit-for-review.

| Subtask state | Leader action | Result |
|---|---|---|
| Not completed (TODO / IN_PROGRESS / IN_REVIEW) | click the status **circle** | Inline **1–5 Work Quality picker** appears on that row. Subtask is **not** yet completed. |
| Picker showing | click a **score (1–5)** | One atomic `PATCH { workQuality, status: 'COMPLETED', progressPercentage: 100 }`. Row → **Completed** with the rating; parent progress refreshes. |
| Picker showing | click **✕** (or click away) | Cancel — subtask unchanged. |
| Completed | click the colored **score badge** | Re-opens the picker to change the rating; subtask **stays Completed** (`PATCH { workQuality }` only). |
| Completed | click the status **circle** | Reopens subtask to TODO / progress 0 (existing reopen behavior; clears completion). |

- Applies to **any** not-completed subtask, not only IN_REVIEW — every leader completion carries a rating (user decision).
- **Out of scope:** cascade steps (they render a numbered badge, no status circle, and follow their own lock/complete flow) and the parent task's own Work Quality section (unchanged).

### Score scale (reuse parent's exact mapping)

`NONE`=1 (gray), `POOR`=2 (red), `FAIR`=3 (yellow), `GOOD`=4 (blue), `EXCELLENT`=5 (green). Identical to the parent task rater for visual consistency.

### Frontend changes (`TaskViewModal.tsx`)

1. Add `workQuality?: WorkQuality | null` to the client `subtasks` array type (data already returned by GET).
2. Add row-local state: `ratingSubtaskId: string | null` (which subtask currently shows the picker).
3. Split the current `handleToggleSubtaskCompletion`:
   - For a `canCompleteTask` viewer clicking the circle on a **not-completed** subtask → set `ratingSubtaskId` (open picker) instead of completing directly.
   - Clicking the circle on a **completed** subtask → reopen (existing COMPLETED→TODO path).
   - Non-`canCompleteTask` viewers (members) → unchanged submit-for-review path.
4. New `handleRateAndCompleteSubtask(subtask, quality)`: optimistic update (status COMPLETED, progress 100, workQuality), single combined PATCH, `toast`, `onTaskUpdate?.()`, `fetchTaskDetails()` to refresh parent rollup; revert on failure. Reused for the "change rating on completed" case with `{ workQuality }` only (no status change).
5. Render: inline picker (5 colored buttons + ✕) when `ratingSubtaskId === subtask.id`; colored score badge on completed subtasks that have a `workQuality`, clickable to re-enter the picker.

### Backend changes

None. Existing `PATCH /api/tasks/[subtaskId]` handles both the combined complete+rate and the rating-only update.

## Feature B — Double-click subtask → Edit / Delete menu

### Interaction

- **Double-click** a subtask row → small popover menu anchored to the row: **Edit** and **Delete**.
- The menu renders **only** if the viewer may manage the subtask: **subtask creator, board leader, or admin**. For anyone else, double-click does nothing (no menu).
- **Edit** → opens the existing task-edit flow for that subtask (reuse the `onEdit` path the parent task already uses; wired for the subtask — see Open question 1).
- **Delete** → `DELETE /api/tasks/[subtaskId]`; on success, optimistic removal from the list + parent refresh + success toast (with **Undo** if cheap to implement). The double-click → explicit Delete pick is itself the deliberate confirmation step, so no extra confirm dialog.

### Click disambiguation

Single-click currently opens the subtask (`onSubtaskClick`). To keep single = open and double = menu: debounce the single-click by ~250ms; if a second click lands within the window, cancel the pending open and show the menu instead. The status-circle button keeps `stopPropagation` so rating clicks never trigger open or menu.

### Permission gate (UI)

Compute a per-subtask `canManageSubtask = isAdmin || isSubtaskCreator || isBoardLeader`. Server remains authoritative on delete. "Board leader" follows the same "in the board" notion the rating permission uses (board owner / board member / board-team leader), not the narrower task-team check.

### Backend changes

1. **Fix pre-existing bug:** the DELETE route calls `canDeleteTask(session.user.role, existingTask.creatorId, session.user.id, teamMember?.role)` — passing the team role into the `assignedById` slot, so the team-leader branch never receives a real `teamMemberRole`. Correct the call to pass `assignedById` (fetch `assignedById` in the `select`) and `teamMember?.role` in their proper positions, so "a leader can delete" actually works.
2. Confirm/adjust so a **board leader** deleting a subtask is authorized server-side (align with the "leader on that board" intent). If `canDeleteTask`'s team-leader path already covers the board's team leader for board-derived teams, no further change; otherwise extend the DELETE route to also accept a board-leader check consistent with `resolveCanRateWorkQuality`.

## Testing / verification

Run the app locally (port 3100 per project setup, seeded DB, Playwright login) and drive both flows with screenshots as proof:

1. **Rate-to-complete:** open a Main task with a submitted subtask as a leader → click the subtask circle → picker appears, subtask still not done → pick a score → subtask flips to Completed showing the rating; parent progress advances. Click the score badge → change rating → persists.
2. **Member view:** as the assignee/member, the circle still submits-for-review; no rating picker appears.
3. **Double-click menu:** as a leader/creator, double-click a subtask → Edit/Delete menu appears; Edit opens the edit flow; Delete removes the subtask. As a non-permitted user, double-click shows nothing.
4. Type-check stays at the `main` baseline (no new errors).

## Open questions (to resolve during implementation)

1. **Edit wiring:** does the parent that renders `TaskViewModal` already expose a subtask-edit entry point, or do we add an `onSubtaskEdit?: (subtaskId) => void` callback (defaulting to opening the subtask's own view→edit)? Resolve by reading the parent usage; pick the smallest change that reuses the existing edit form.
2. **Board-leader delete authorization** server-side (Feature B backend item 2) — verify against `canDeleteTask` and extend only if needed.

## Non-goals

- No schema/migration changes (all fields already exist).
- No change to the parent task's own Work Quality section, to cascade-step behavior, or to the member submit-for-review flow.
- No bulk "rate all" action — each subtask is rated individually (kept simple; can follow later if wanted).
