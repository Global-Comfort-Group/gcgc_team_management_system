# Schedule-Health Tag + Copyable Board ID — Design

**Date:** 2026-07-23
**Branch:** `feat/public-task-api`
**Status:** Approved design, pending implementation plan

This spec covers two independent features that happen to be requested together.
They share no code and can be built/merged separately.

- **Feature A — Schedule-Health Tag:** a three-state derived badge
  (Delayed / On Track / Ahead of Schedule) on tasks.
- **Feature B — Copyable Board ID:** surface a board's `id` in the web UI so a
  user can copy it and hand it to the `/to-tms` skill; plus a `/to-tms` skill
  update to accept a Board ID directly.

---

## Feature A — Schedule-Health Tag

### Goal

Replace the current binary "overdue / not overdue" signal with a richer
three-state schedule-health tag, so a task communicates whether it is behind,
proceeding within its deadline, or was finished early.

### Core logic (derived, no schema change)

A pure function lives next to the existing `isTaskOverdue` in
`src/lib/overdue.ts` (or a sibling `src/lib/schedule-health.ts` that imports
from it):

```ts
export type ScheduleHealth = 'DELAYED' | 'ON_TRACK' | 'AHEAD'

export function getScheduleHealth(
  task: OverdueCheckable,   // { status, dueDate?, memberSubmittedAt?, leaderEvaluatedAt? }
  now?: Date,
): ScheduleHealth | null
```

Rules — day-granular, matching the existing overdue boundary (a task due
*today* is not late; anything strictly past the due day is):

| Task state | Condition | Result |
|---|---|---|
| No `dueDate` | — | `null` (no badge) |
| `CANCELLED` / `BACKLOG` | parked / called off | `null` (no badge) |
| Done (`IN_REVIEW` or `COMPLETED`) | `memberSubmittedAt` on/before due day | `AHEAD` |
| Done (`IN_REVIEW` or `COMPLETED`) | `memberSubmittedAt` after due day | `DELAYED` |
| Active (`TODO` / `IN_PROGRESS`) | now past due day | `DELAYED` |
| Active (`TODO` / `IN_PROGRESS`) | now on/before due day | `ON_TRACK` |

Invariants and edge cases:

- **`DELAYED` coincides with `isTaskOverdue()` for active + `IN_REVIEW` tasks,
  but not for `COMPLETED`.** `isTaskOverdue` treats `COMPLETED` as *never
  overdue* (an actionable signal — nothing to act on once done). Schedule-health
  is a *historical* judgment, so a task **completed after its due day is
  `DELAYED`** even though `isTaskOverdue` returns `false` for it. This is the one
  intentional divergence. For every non-`COMPLETED` status, `health ===
  'DELAYED'` iff `isTaskOverdue(task, now)`. The badge's "Delayed" state
  supersedes the old standalone overdue indicator on active tasks.
- **`AHEAD` reuses the overdue rule's finish reference:** `memberSubmittedAt`
  (when the member moved the task to review / marked it done), *not*
  `leaderEvaluatedAt`. A task submitted on time is never penalized for approval
  delay — consistent with how `isTaskOverdue` already treats `IN_REVIEW`.
- **A done task submitted exactly on the due day** is `AHEAD` (day-granular:
  "not late" ⇒ not `DELAYED` ⇒ `AHEAD`). We fold on-time into `AHEAD` rather
  than adding a fourth "On Time" state, to keep this simple. (Revisit only if
  the user later wants an explicit on-time bucket.)
- **Done task with no `memberSubmittedAt`** (legacy rows): the finish reference
  is `memberSubmittedAt ?? leaderEvaluatedAt`. If both are null, an `IN_REVIEW`
  task falls back to comparing **now** (matching `isTaskOverdue`'s IN_REVIEW
  fallback, so the two stay consistent), while a `COMPLETED` task with no stamps
  returns `null` (no badge) rather than guess when it finished.

Unit tests mirror `src/lib/overdue.test.ts`, covering: no due date, active
before/after due, done submitted before/on/after due, CANCELLED/BACKLOG,
legacy null-timestamp fallback, and the `DELAYED === isTaskOverdue` invariant.

### Rendering — one reusable component

`src/components/tasks/ScheduleHealthBadge.tsx`:

```tsx
<ScheduleHealthBadge task={task} compact? />
```

- Calls `getScheduleHealth(task)`. Renders `null` (nothing) when the result is
  `null` — so tasks with no due date show no badge.
- Renders a shadcn `Badge`. Every surface uses this one component so appearance
  and logic stay consistent.

| State | Color | Full label | Compact label |
|---|---|---|---|
| `DELAYED` | red / destructive | Delayed | Delayed |
| `ON_TRACK` | slate / blue | On Track | On Track |
| `AHEAD` | green | Ahead of Schedule | Ahead |

### Placement

The badge replaces / augments the current overdue indicator on these surfaces
(all four confirmed by the user):

1. **TaskViewModal** — full-label badge in the detail panel.
2. **Task cards + list rows** — compact badge on the Kanban board and in task
   lists on user + admin task pages. Replaces the standalone "overdue"
   indicator, since `DELAYED` supersedes it.
3. **Dashboards / reports** — dashboard task widgets that list tasks show the
   badge.

**Implementation risk to resolve in the plan:** the badge derives from
`dueDate`, `status`, and `memberSubmittedAt`. Some API payloads that feed these
surfaces may not currently include `memberSubmittedAt` (and possibly
`leaderEvaluatedAt`). The plan must enumerate each rendering surface, verify its
payload carries these fields, and add them to the relevant `select` / response
shape where missing. Without `memberSubmittedAt`, a done task falls back to
`leaderEvaluatedAt` then `null`, so a missing field degrades gracefully but
loses the `AHEAD` signal.

### Out of scope (first pass)

- Rich report **aggregations** (e.g. "N ahead / M on track / K delayed" tallies
  across a team). Existing overdue counts stay as-is because `DELAYED` = overdue.
  Optional Ahead/On-Track breakdowns are a deliberate follow-up.
- No stored `scheduleHealth` column, no migration. Fully derived.

---

## Feature B — Copyable Board ID + `/to-tms` update

### Context / why this is small

The backend already supports board IDs end-to-end on the local box
(`10.100.100.86:3000`, this branch):

- `POST /api/public/tasks` already accepts a **`boardId`** string (not a name)
  and authorizes it via `accessibleBoardWhere`.
- `GET /api/public/boards` already returns each accessible board's `id` + `name`.
- `to-tms`'s `tms.py boards` command already prints `<id>\t<name>` per line and
  the skill already passes `boardId` to the API; its current step 3 fuzzy-matches
  a *name* → id.

The only gaps are (1) no convenient place in the web UI to *see/copy* a board's
id, and (2) the skill doesn't accept a pasted id directly.

### B1 — Board ID row in Board settings dialog

`src/components/tasks/BoardSettingsDialog.tsx` already receives `boardId` and
`boardName` as props and already uses the `navigator.clipboard.writeText` +
toast pattern (for form links). Add a small **"Board ID"** row at the top of the
dialog body:

```
Board settings
--------------------------------------------
Board ID   clx1a2b3c4d5e6...        [Copy]
--------------------------------------------
Statuses / Fields / Forms ...
```

- Monospace, truncated/selectable id + a copy button that writes the full id to
  the clipboard and fires the existing toast (`{ title: 'Board ID copied' }`).
- No API change, no schema change. Settings dialog only (board header stays
  uncluttered, per user choice).

### B2 — `/to-tms` skill accepts a Board ID directly

Edit `~/.claude/skills/to-tms/SKILL.md` (step 3 "Resolve a board name → id"):

- If the user supplies something that **looks like a board id** (a cuid:
  `^c[a-z0-9]{24,}$`, e.g. `clx…` / `cm…`), use it verbatim as `boardId` and
  **skip** the `boards` listing / name-match entirely.
- Keep the existing name → id fuzzy match as the fallback for when the user
  names a board instead of pasting an id.
- Note in the skill that the user can copy a board's id from **Board settings →
  Board ID** in the TMS web app.

This is a skill-file edit outside the repo; it is not part of the app build and
ships independently of Features A / B1.

---

## Deployment note

- The `boardId`-accepting public API is **already deployed** to the local box
  `10.100.100.86:3000`; it is **not** on staging/prod (migration pending).
- Features A and B1 are **new, unbuilt** web-app changes. Once built they deploy
  with the normal app deploy to the local box; staging/prod follow the existing
  pending-migration cadence for this branch.
- Feature B2 is a local skill-file edit, effective immediately for the user.

---

## Build order (independent slices)

1. **A** — schedule-health function + tests → badge component → wire into
   surfaces (payload audit per surface).
2. **B1** — Board ID row in settings dialog.
3. **B2** — `/to-tms` SKILL.md edit.

Each can be a separate commit/PR; none depends on another.
