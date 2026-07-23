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

Rules — **week-granular (weeks run Monday–Sunday).** The comparison unit is the
deadline's calendar week, not its exact day. Let `week(d)` = the Monday 00:00 of
the Mon–Sun week containing `d`. A task stays fine for the whole of its deadline
week and is only late once that week has fully passed.

| Task state | Condition | Result |
|---|---|---|
| No `dueDate` | — | `null` (no badge) |
| `CANCELLED` / `BACKLOG` | parked / called off | `null` (no badge) |
| Done (`IN_REVIEW` or `COMPLETED`) | `week(finish)` ≤ `week(dueDate)` | `AHEAD` |
| Done (`IN_REVIEW` or `COMPLETED`) | `week(finish)` > `week(dueDate)` | `DELAYED` |
| Active (`TODO` / `IN_PROGRESS`) | `week(now)` ≤ `week(dueDate)` | `ON_TRACK` |
| Active (`TODO` / `IN_PROGRESS`) | `week(now)` > `week(dueDate)` | `DELAYED` |

`finish` = `memberSubmittedAt ?? leaderEvaluatedAt` (see fallback below).

Worked example (weeks: A = Jun 29–Jul 5, B = Jul 6–12, C = Jul 13–19; today = Wed
Jul 8, week B):
- Active, due **Mon Jul 6** (earlier this week) → **On Track** (still week B), even
  though the exact due date has passed. Becomes **Delayed** only from Mon Jul 13.
- Active, due **Jul 2** (week A, passed) → **Delayed**.
- Active, due **Jul 15** (week C, future) → **On Track**.
- Done, submitted **Jul 8** for a task due **Jul 6** (same week B) → **Ahead**.
- Done, submitted **Jul 8** (week B) for a task due **Jul 2** (week A) → **Delayed**.

Invariants and edge cases:

- **Weekly ≠ the day-based `isTaskOverdue`.** This badge no longer tracks
  `isTaskOverdue` (which stays day-granular and drives overdue *counts,
  notifications, and the cron*). A task past its exact due date but still inside
  its deadline week is `isTaskOverdue === true` yet schedule-health `ON_TRACK`.
  That is intended — the two answer different questions (actionable-overdue vs
  weekly schedule-health). Only `getScheduleHealth` changed; `isTaskOverdue` and
  its callers are untouched.
- **`AHEAD`/`DELAYED` finish reference** is `memberSubmittedAt`, falling back to
  `leaderEvaluatedAt` — the member's submission, not blamed for approval delay.
- **Done within (or before) the deadline week is `AHEAD`.** A task submitted late
  in its own deadline week still counts as `AHEAD`; only a *later* week is
  `DELAYED`. Done tasks never show `ON_TRACK` (that state is for pending work).
- **Done task with no `memberSubmittedAt`** (legacy rows): finish =
  `memberSubmittedAt ?? leaderEvaluatedAt`. If both are null, an `IN_REVIEW` task
  falls back to comparing **now**, while a `COMPLETED` task with no stamps returns
  `null` (no badge) rather than guess when it finished.

Unit tests cover: no due date, CANCELLED/BACKLOG, active in a past/current/future
week (incl. the "on track until the week ends" transition), done finished
before/within/after the deadline week, legacy null-timestamp fallback, and ISO
string inputs.

**UI reconciliation:** on the user tasks list the due-date text currently turns
red via day-based `isTaskOverdue`. To avoid a "red date + On Track badge"
mismatch, that red styling is switched to the weekly `getScheduleHealth(...) ===
'DELAYED'` so the text and badge always agree.

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
