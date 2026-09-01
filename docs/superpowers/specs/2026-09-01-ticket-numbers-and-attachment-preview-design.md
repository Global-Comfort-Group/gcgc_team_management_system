# Task Ticket Numbers + Attachment Preview — design

Batch 2 of the nine-item request (2026-09-01). Covers reported items #2 (ticket
number per task), #3 (manually assign a ticket number), and #9 (preview image
and PDF attachments). Batch 1 (bugs) shipped separately; batch 3 (board roles,
templates) has its own spec.

## Problem

Tasks have no human-quotable identifier. People refer to work by title, which is
ambiguous the moment two tasks are named similarly, and impossible to use in
chat, email, or a meeting. Task IDs exist but are cuids
(`cmti18wfd000jm35bwbqs5ioz`) — unusable out loud.

Separately, attachments can only be downloaded. Reviewing a screenshot or a PDF
means saving it to disk and opening it, which is slow enough that people skip it.

## Decisions taken

- **Format: per-board prefix + sequence** (`OPS-1`, `OPS-2`, `DEV-1`) — chosen
  by the product owner over a global counter or fully-manual entry.
- Manual assignment (#3) must be possible, so the number cannot be a pure
  derived value.

## ⚠️ Open decision — board-less tasks

Measured on production 2026-09-01:

| | Count | Share |
|---|---:|---:|
| Tasks **with** a board | 567 | 42% |
| Tasks **without** a board | 778 | **58%** |
| Boards (all are team boards) | 25 | |

**A per-board scheme cannot number 58% of existing tasks.** This was not visible
when the format was chosen and it needs an explicit answer. Three options:

1. **Global fallback prefix (recommended).** Board-less tasks get `TMS-1`,
   `TMS-2`… from a system counter; board tasks get their board's prefix. Every
   task is quotable, which is the entire point of the feature. Cost: two
   counters, and a task moved onto a board later keeps its `TMS-` number.
2. **Board tasks only.** Board-less tasks show no ticket number. Cheapest, but a
   feature that works for 42% of tasks will read as broken.
3. **Assign every task to a board first.** Cleanest end state, but it is a data
   migration and a product decision well beyond this batch.

This spec assumes **option 1**. It is the only choice under which "quote me the
ticket number" always works.

**Backfill:** yes, under option 1 — numbering only new tasks leaves 1,345 tasks
permanently unquotable. Order by `createdAt` within each board (and within the
global bucket), so numbers roughly track chronology. Each counter is then set to
its max assigned value.

## Data model (migration required)

```prisma
model KanbanBoard {
  // Uppercase short code, e.g. "OPS". Null until the board owner sets one, in
  // which case that board's tasks fall back to the global prefix.
  ticketPrefix  String?  @db.VarChar(10)
  // Last number issued for this board. Never decremented — reusing a number
  // after a delete would make old references point at different work.
  ticketCounter Int      @default(0)
}

model Task {
  // Full display value, e.g. "OPS-14". Denormalised so lists and search do not
  // need a board join, and so a manually-set number survives a board move.
  ticketNumber String? @unique
}

// Single row. Holds the counter for tasks with no board.
model TicketSequence {
  id      String @id @default("global")
  prefix  String @default("TMS") @db.VarChar(10)
  counter Int    @default(0)
}
```

`ticketNumber` is globally `@unique`, not unique-per-board: prefixes make
collisions across boards impossible anyway, and a global constraint is what
makes "look up by ticket number" a single indexed query.

## Allocation logic (`src/lib/ticket-number.ts`)

Pure helpers, unit-tested:

- `formatTicket(prefix, seq)` → `"OPS-14"`
- `parseTicket(value)` → `{ prefix, seq } | null`; rejects anything not
  `^[A-Z][A-Z0-9]{0,9}-\d+$`
- `normalisePrefix(input)` → uppercased, stripped of non-alphanumerics, capped
  at 10 chars

Allocation itself is **not** pure and must be atomic:

```
UPDATE kanban_boards SET "ticketCounter" = "ticketCounter" + 1
WHERE id = $1 RETURNING "ticketCounter"
```

run **inside the task-create transaction**. A read-then-write in application
code lets two simultaneous creates read the same value and produce duplicate
numbers — with a `@unique` column that surfaces as a failed task creation, so
this is a correctness requirement, not an optimisation.

### Manual assignment (#3)

Manual numbers and the counter share a namespace, so they can collide. Rules:

1. A manual number must parse and be unique, else the request is rejected with a
   clear message naming the conflicting task. No silent renumbering.
2. **When a manual number is accepted, bump that prefix's counter to at least
   its sequence.** Without this, someone typing `OPS-500` today guarantees a
   unique-violation failure when the counter eventually reaches 500 — a bug that
   would surface months later with no obvious cause.
3. Manual numbers may use any prefix, including one no board owns. Enforcing
   prefix ownership would block the main use case (importing an ID from another
   system).
4. Clearing a manual number reverts the task to unnumbered; it is not
   re-allocated automatically, to avoid surprising renumbering.

### Backfill

A script, not a migration — it is long-running and must be resumable:

- Board tasks: group by `boardId`, order by `createdAt`, assign sequentially.
- Board-less tasks: order by `createdAt`, assign from the global prefix.
- Boards with no `ticketPrefix` set: derive a candidate from the board name
  (first 3 alphanumerics, uppercased), deduplicated with a numeric suffix. A
  wrong-but-editable prefix beats leaving those tasks unnumbered.
- Idempotent: skip any task that already has a `ticketNumber`.

## API

- `POST /api/tasks` — allocates a number in-transaction. Accepts an optional
  `ticketNumber` for manual assignment (validated per the rules above).
- `PATCH /api/tasks/[id]` — accepts `ticketNumber` (set / change / clear).
  Permission: whoever may edit the task.
- `PATCH /api/boards/[id]` — accepts `ticketPrefix`. Changing a prefix does
  **not** renumber existing tasks; their numbers are already in circulation.
- `GET /api/tasks?search=` — extend the existing search to match
  `ticketNumber` exactly (case-insensitive) before falling back to title/description.

## UI

- **Task card**: ticket number as a small monospace label above the title.
- **TaskViewModal**: ticket number beside the title, click-to-copy — mirroring
  the existing copyable Board ID from the schedule-health work.
- **Board Settings**: a Ticket Prefix field with live preview ("Next: OPS-15").
- **TaskForm**: an optional Ticket Number field, blank meaning auto-allocate,
  with inline validation for format and uniqueness.
- **Excel export**: ticket number as the first column.

## Attachment preview (#9)

**The constraint that dictates the design:** Alibaba OSS serves files from its
default endpoint with `Content-Disposition: attachment` and
`x-oss-force-download`, so `window.open()` on an attachment URL saves the file
instead of showing it. This is already documented in `TaskViewModal.tsx:418` and
already solved once — comment images use an in-app lightbox for exactly this
reason. **Attachment preview must reuse that approach, not open URLs.**

- **Images** (`image/*`): existing lightbox component, extended to accept an
  attachment as well as a comment image. Same escape-to-close, click-outside,
  and object-contain sizing.
- **PDFs** (`application/pdf`): render in an `<iframe>` inside a dialog. Note
  the force-download header applies here too — if the iframe downloads instead
  of rendering, the fix is a proxy route (`/api/attachments/[id]/raw`) that
  streams the file with `Content-Disposition: inline`. **Verify which is needed
  before building the proxy**; it may be unnecessary.
- **Everything else**: unchanged download behaviour, with the file-type icon
  already shown.
- Preview is view-only. No annotation, no editing.

## Out of scope (v1)

- Renumbering existing tasks when a board prefix changes
- Per-board ticket number *formats* (padding, custom separators)
- Office/video attachment preview
- Ticket numbers on subtasks — they inherit the parent's context; giving each
  step its own number would multiply identifiers without adding meaning

## Build order

1. Schema + migration (`ticketPrefix`, `ticketCounter`, `ticketNumber`, `TicketSequence`)
2. `src/lib/ticket-number.ts` + unit tests (format, parse, normalise, collision rules)
3. Atomic allocation in `POST /api/tasks`, in-transaction
4. Manual assignment via `PATCH`, including the counter-bump rule
5. Backfill script, run against a restored copy of production first
6. UI: card, modal, board settings, form, export
7. Search by ticket number
8. Attachment preview: images via the existing lightbox, then PDFs — measuring
   the force-download behaviour before deciding on the proxy route

## Verification

- Unit tests for format/parse/normalise and the collision rules
- Concurrency: create N tasks on one board simultaneously, assert N distinct
  numbers and no failures — the failure mode a read-then-write would produce
- Backfill on a restored production copy: every task numbered, no duplicates,
  counters equal to their max
- Attachment preview driven in a real browser against real OSS files, since the
  force-download behaviour is an OSS response header and cannot be reproduced
  locally
