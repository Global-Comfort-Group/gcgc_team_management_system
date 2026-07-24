# Board Reviewers — Jira-style review assignment

**Date:** 2026-07-24
**Branch:** `feat/board-reviewers`
**Status:** Approved design, implementing

## Problem

A leader who does a task can currently rate + complete it themselves ("rate my
own work"), because `canFinalize`/`canRate` include the creator/board-leader and
the same person is both worker and approver. There's no independent review step
for a leader's own work.

## Solution (approved)

Jira-style review assignment, scoped per kanban board:

- Each board has a **pool of eligible reviewers** (leaders — from this team or
  another). Managed in Board Settings by a board leader.
- When a task (or subtask) is **In Review**, a specific **reviewer** is assigned
  from that pool. Either the submitter or any board leader/admin can set/change
  it.
- Only the **assigned reviewer (or an admin)** can rate + complete. The
  worker/assignee can only submit (`IN_REVIEW`) and pick the reviewer — they
  **cannot approve their own work**.

**Opt-in per board:** a board only changes behavior once it has ≥1 eligible
reviewer configured. Boards with an empty pool keep today's behavior (any board
leader completes) — fully backward compatible. Applies to **subtasks too** (they
use the parent task's board pool).

## Data model (migration required)

```prisma
model BoardReviewer {
  id        String      @id @default(cuid())
  boardId   String
  userId    String
  createdAt DateTime    @default(now())
  board     KanbanBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  user      User        @relation("BoardReviewerUser", fields: [userId], references: [id], onDelete: Cascade)
  @@unique([boardId, userId])
  @@index([boardId])
}

model Task {
  // ...
  reviewerId String?
  reviewer   User?  @relation("TaskReviewer", fields: [reviewerId], references: [id], onDelete: SetNull)
}

// KanbanBoard: reviewers BoardReviewer[]
// User: boardReviewerOf BoardReviewer[] @relation("BoardReviewerUser")
//       reviewingTasks   Task[]         @relation("TaskReviewer")
```

- Migration file must be created with `prisma migrate diff` (local shadow DB is
  broken) and **`git add -f`'d** (prisma/migrations is gitignored — see
  deployment notes) or it never reaches the servers.
- No backfill needed — `reviewerId` null and empty pools = current behavior.

## Permission logic (the enforcement)

New helper (unit-tested), consumed by `canFinalizeTask` / `resolveCanRateWorkQuality`
callers in `PATCH /api/tasks/[id]`:

For a task whose board has a **non-empty** reviewer pool:
- The task's **assignee(s)/worker is excluded** from finalize + rate on that task.
- Only `task.reviewerId === viewer` (or admin) may finalize + rate.
- If `reviewerId` is null, the task cannot be completed (must assign a reviewer
  first); it can still sit in review.

For a task whose board pool is **empty** (or a board-less task): unchanged —
existing `canFinalize`/`canRate` apply.

Resolution details:
- A **subtask** resolves its board via its parent (subtasks may have
  `boardId = null`); the pool + enforcement come from the parent's board.
- "Assigned reviewer" is authoritative; board-pool membership only gates *who can
  be assigned*, not who can complete.
- Admin always retains override (and the senior-override rating path is
  unchanged).

## API

- `GET/POST/DELETE /api/boards/[id]/reviewers` — list / add / remove eligible
  reviewers (board owner or board leader; admin). POST body `{ userId }`,
  validated to a LEADER (or admin) the assigner may add.
- `GET /api/boards/[id]/reviewers/candidates` (or reuse an existing member/leader
  search) — leaders selectable for the pool.
- `PATCH /api/tasks/[id]` — accept `reviewerId` (nullable). Authorize: submitter
  or board leader/admin may set it, only to a user in the board's pool, never the
  task's own assignee. Fold reviewer enforcement into the existing complete/rate
  gates.

## UI

1. **Board Settings** (`BoardSettingsDialog`) — a "Reviewers" section: search +
   add leaders to the pool, list with remove. Mirrors the existing statuses/
   fields/forms tabs.
2. **TaskViewModal** — when a task is `IN_REVIEW` (or has a reviewer), show
   **Reviewer: X** with an assign/change control (dropdown of the board pool),
   visible to the submitter and board leaders/admin. The **rate-to-complete
   modal** and completion affordance are shown **only to the assigned reviewer or
   an admin** — the worker no longer sees them on their own task.
3. **Subtask rows** — same reviewer assign control per subtask in review; the
   rate-to-complete circle is gated to the subtask's reviewer/admin.

## Out of scope (v1)

- Auto-assigning a default reviewer (always manual per task).
- Multiple reviewers / review approvals quorum.
- Reviewer notifications beyond the existing task-update notifications (can
  follow).

## Build order

1. Schema + migration (`git add -f`).
2. Reviewer permission helper + unit tests.
3. Board reviewers API + task `reviewerId` in PATCH (+ enforcement).
4. UI: Board Settings pool → TaskViewModal assign + gate → subtask rows.

Each slice type-checks + tests green before the next; feature branch merges to
`main` only when the whole flow is verified.
