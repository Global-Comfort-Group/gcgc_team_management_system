# Custom Board Roles + Role-Based Assignment + Task Templates — design

Batch 3 of the nine-item request (2026-09-01). Covers reported items #1 (custom
roles per team board), #5 (assign a task per role), and #4 (customise the
default task template). This is the highest-risk batch: it introduces an
access-control layer, so it is specified before any code is written.

## Problem

A board today knows only two things about a person: whether they can reach it,
and whether they lead the team. Real boards have Designers, QA, Approvers, and
Requesters, and people want to say "this task goes to whoever is QA" rather than
naming an individual who may be on leave.

Separately, every new task starts from the same blank form. Boards with a
repeating shape (same checklist, same weight, same default assignee) retype it
every time.

## Decision taken

Custom roles carry **label + permissions** — chosen by the product owner over a
label-only role or a full replacement of the existing per-team role. This makes
it a real access-control layer and dictates most of what follows.

## The constraint that shapes everything: three role systems already exist

| System | Model | Scope | Purpose |
|---|---|---|---|
| Global role | `User.role` | Whole app | ADMIN / LEADER / MEMBER |
| Team role | `TeamMember.role` | Per team | LEADER / MEMBER — "can manage this team" |
| Reviewer pool | `BoardReviewer` | Per board | Who may approve work |

Board access itself is separate again (`src/lib/board-access.ts`): owner, explicit
`KanbanBoardMember`, or membership of the board's team.

**Board roles are a fourth system and must layer on top, never replace.**
Replacing `TeamMember.role` would touch every existing permission check across
132 API routes and require a data migration, for no gain the layered model does
not already provide.

### The layering rule

Effective permission = **existing checks OR board-role grants**. Board roles can
only *grant*, never *revoke*. Concretely:

- ADMIN keeps everything, unconditionally.
- A team LEADER keeps full management of their board regardless of board roles.
- `BoardReviewer` continues to gate approval; a board role may add someone to
  that capability but never remove an existing reviewer's rights.
- A member with no board role behaves exactly as today.

This makes the feature strictly additive, which means it cannot break existing
boards — the property that matters most when shipping access control to a live
system.

### The invariant

**A board must always retain at least one person who can administer it.** Any
change that would leave a board with no admin — removing the last role that
grants `MANAGE_BOARD`, or stripping your own — is rejected, exactly as
`wouldLeaveTeamLeaderless` already guards teams. Team LEADERs satisfy this
inherently, so in practice it bites only on boards administered purely by custom
roles.

## Data model (migration required)

```prisma
model BoardRole {
  id          String   @id @default(cuid())
  boardId     String
  name        String                        // "Designer", "QA", "Approver"
  color       String   @default("#6B7280")
  // Permission flags, stored as explicit columns rather than a JSON blob so
  // they are queryable and a typo becomes a compile error, not a silent false.
  canCreateTask   Boolean @default(false)
  canEditAnyTask  Boolean @default(false)
  canDeleteTask   Boolean @default(false)
  canChangeStatus Boolean @default(false)
  canApprove      Boolean @default(false)   // joins the reviewer capability
  canManageBoard  Boolean @default(false)   // settings, roles, columns
  position    Int      @default(0)
  createdAt   DateTime @default(now())

  board       KanbanBoard         @relation(fields: [boardId], references: [id], onDelete: Cascade)
  assignments BoardRoleAssignment[]
  tasks       Task[]              @relation("TaskAssignedRole")

  @@unique([boardId, name])       // one "QA" per board
  @@index([boardId])
  @@map("board_roles")
}

model BoardRoleAssignment {
  id        String   @id @default(cuid())
  roleId    String
  userId    String
  createdAt DateTime @default(now())

  role BoardRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
  user User      @relation("BoardRoleUser", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([roleId, userId])
  @@index([userId])
  @@map("board_role_assignments")
}

model Task {
  // #5: the task is addressed to a role. Kept ALONGSIDE assigneeId, not instead
  // of it — see "Assign per role" below.
  assignedRoleId String?
  assignedRole   BoardRole? @relation("TaskAssignedRole", fields: [assignedRoleId], references: [id], onDelete: SetNull)
}
```

Flags as columns, not JSON: a JSON permission bag cannot be filtered in SQL, and
a misspelled key reads as `undefined` → denied, which is the worst possible
failure mode for access control (silent, and always in the direction of "no").

## Assign per role (#5)

**A role is not an assignee.** Notifications, workload, "my tasks", and overdue
all key off a real user. A task assigned only to "QA" belongs to nobody, and
every one of those features would silently skip it.

So `assignedRoleId` is **addressing**, not ownership:

- Setting a role records the intent and surfaces the task to everyone holding
  that role on the board ("Unclaimed — QA").
- **Exactly one holder** → auto-assign them immediately; the role is a shortcut,
  not a new state.
- **Several holders** → the task stays unassigned but visible to all of them,
  and any one can claim it, which sets `assigneeId` normally.
- **No holders** → creation is rejected. A task addressed to an empty role is
  invisible work.
- Clearing the role leaves `assigneeId` untouched.

This keeps every existing assignee-based feature working unchanged.

## Task templates (#4)

```prisma
model BoardTaskTemplate {
  id            String   @id @default(cuid())
  boardId       String   @unique          // one default template per board (v1)
  titlePrefix   String?
  description   String?
  priority      Priority?
  taskWeight    Int?
  slaHours      Int?
  defaultRoleId String?                   // pre-select an assigned role
  checklist     Json?                     // [{ title }] seeded as subtasks
  updatedAt     DateTime @updatedAt

  board KanbanBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  @@map("board_task_templates")
}
```

Templates are **defaults, not constraints** — every field stays editable in the
form. A template that locked fields would be a workflow engine, which is not
what was asked for.

One template per board in v1. Multiple named templates is the obvious v2 and the
schema does not preclude it (drop the `@unique`, add a name).

## Permission resolution (`src/lib/board-roles.ts`)

One pure function, exhaustively unit-tested, consumed everywhere:

```ts
resolveBoardPermissions({
  userId, userRole, board, teamMemberRole, boardRoles, reviewerIds
}): {
  canCreateTask, canEditAnyTask, canDeleteTask,
  canChangeStatus, canApprove, canManageBoard
}
```

Rules, in order:
1. ADMIN → all true.
2. Board owner or team LEADER → all true.
3. Otherwise: union of the flags from every board role the user holds.
4. `canApprove` additionally true if in `BoardReviewer`.
5. No roles, not a leader → today's behaviour exactly.

**These are board-level capabilities, not per-task overrides.** In particular
`canApprove` means "may act as an approver on this board" — it does **not** lift
the per-task rule that a leader cannot approve their own work, which is the
entire reason the reviewer pool exists. `resolveBoardPermissions` answers "what
may this person do here"; the existing per-task checks still answer "may they do
it to *this* task", and they run after.

Routes call this instead of growing their own checks — the same
"one source of truth" reason `task-scope.ts` exists after the dashboard drifted
from the Tasks tab.

## API

- `GET/POST /api/boards/[id]/roles` — list / create (needs `canManageBoard`)
- `PATCH/DELETE /api/boards/[id]/roles/[roleId]` — edit / delete; delete is
  refused if it would breach the last-admin invariant
- `POST/DELETE /api/boards/[id]/roles/[roleId]/members` — assign / unassign
- `GET/PUT /api/boards/[id]/template` — read / upsert the template
- `PATCH /api/tasks/[id]` — accepts `assignedRoleId`, applying the claim rules

## UI

- **Board Settings → Roles**: list with colour chips, permission checkboxes, and
  member assignment. Follows the existing Board Settings dialog patterns.
- **TaskForm**: an "Assign to role" selector beside the assignee picker, showing
  how many people hold each role so an empty role is obvious before submit.
- **Task card**: role chip when a task is role-addressed and unclaimed.
- **TaskViewModal**: a Claim button for holders of the addressed role.
- **Board Settings → Template**: the default-task form.

## Out of scope (v1)

- Cross-board roles (a role is per board, matching the request)
- Role hierarchies or inheritance
- Roles that *revoke* permission — additive only, deliberately
- Per-column or per-field permissions
- Multiple named templates per board

## Build order

Each step is independently shippable; permissions land before anything depends
on them.

1. Schema + migration for `BoardRole` / `BoardRoleAssignment`
2. `src/lib/board-roles.ts` + exhaustive unit tests (including the invariant)
3. Roles API, with the last-admin guard
4. Board Settings → Roles UI
5. Wire `resolveBoardPermissions` into the task routes — the riskiest step;
   verify existing boards behave identically before and after
6. `Task.assignedRoleId` + claim rules
7. Role UI on form, card, and modal
8. Templates: model, API, settings UI, form prefill

## Verification

- Unit tests for every branch of `resolveBoardPermissions`, plus the last-admin
  invariant
- **A regression pass proving a board with no custom roles behaves exactly as it
  does today** — the single most important check, since this layer touches
  live permission paths
- Explicitly: **a leader still cannot approve their own work**, with or without a
  role granting `canApprove`. Step 5 of the build order is where that could be
  silently weakened
- Role assignment and claiming driven in a real browser
- Confirm role deletion cannot orphan a board
