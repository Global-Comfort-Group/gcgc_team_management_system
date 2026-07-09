# Public Task-Creation API — Design

**Date:** 2026-07-09
**Status:** Approved (pending spec review)

## Goal

Expose a token-authenticated HTTP API so an external agent / LLM can create tasks
(and nested subtasks) in the GCGC TMS from natural-language prompts. The agent is
given an OpenAPI spec it can import to auto-generate the tool.

## Scope (v1)

In scope:
- Create a task with optional description, deadline, board, self-assignment, and nested subtasks.
- List the caller's boards (for name discovery).
- Serve an OpenAPI 3.1 spec.
- Manage personal API tokens from the user profile page (generate / list / revoke).

Explicitly out of scope for v1:
- Assigning to users other than the token owner.
- Setting priority via the API (always MEDIUM; changed later in the app).
- Updating / deleting tasks via the public API.
- Multi-tenant / shared-secret auth.

## Decisions (locked with user)

1. **Auth:** Personal API token (Bearer), tied to the owner's user account. Every
   created task's `creator` is the token owner. Revocable.
2. **Board:** Optional. Referenced by the board's **existing unique `id`**
   (`boardId`), not by name — this sidesteps duplicate-name issues with no schema
   change. When omitted, the task is created with no board (unassigned/backlog).
   A discovery endpoint lists the caller's boards as `{ id, name }` so the agent
   can resolve a name to its id.
3. **Subtasks:** Nested array in a single request; created atomically with the parent.
4. **Delivery:** REST endpoints + an OpenAPI 3.1 spec at a public URL.
5. **Token management UI:** A card on the user **profile page**, not a CLI script.
6. **Assignment:** `assignTo` is `"me"` (token owner) or omitted (unassigned). No other users.
7. **Priority:** Always `MEDIUM` on creation; the user changes it later in the TMS app.
8. **Description:** Optional in the API; can also be filled in later in the TMS.

## Architecture

New public endpoints under `src/app/api/public/*` that authenticate via API token
(NOT NextAuth session):

```
POST /api/public/tasks          Create a task (+ nested subtasks), atomically
GET  /api/public/boards         List the caller's boards: [{ id, name }]
GET  /api/public/openapi.json   OpenAPI 3.1 spec (public, no data)
```

Token-management endpoints under `src/app/api/settings/api-tokens/*` authenticate via
the normal NextAuth session (the logged-in user managing their own tokens):

```
GET    /api/settings/api-tokens        List caller's tokens (no secret, just metadata)
POST   /api/settings/api-tokens        Create a token; returns the raw token ONCE
DELETE /api/settings/api-tokens/:id    Revoke (soft: set revokedAt)
```

Task creation reuses existing helpers so token-created tasks behave identically to
UI-created ones: `resolveTeamBoardLink` (board → teamId inheritance) and
`setTaskAssignees` (flat assignee list).

## Data model

New Prisma model (requires a migration on local/staging/prod):

```prisma
model ApiToken {
  id         String    @id @default(cuid())
  userId     String
  name       String                       // human label, e.g. "my-agent"
  tokenHash  String    @unique            // SHA-256 hex of the raw token
  lastUsedAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  user       User      @relation("UserApiTokens", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("api_tokens")
}
```

Add the inverse relation `apiTokens ApiToken[] @relation("UserApiTokens")` on `User`.

- Raw token format: `gcgc_<43-char base64url of 32 random bytes>`.
- Only the SHA-256 hash is stored. A DB leak does not expose usable tokens.
- The raw token is returned exactly once, at creation time.

## Auth flow (public endpoints)

1. Read `Authorization: Bearer <raw>` header. Missing/malformed → `401`.
2. Hash `<raw>` with SHA-256; look up `ApiToken` where `tokenHash` matches and
   `revokedAt IS NULL`. No row → `401`.
3. Load `token.user`; if `user.isActive === false` → `401`.
4. Set `lastUsedAt = now()` (best-effort, non-blocking).
5. The resolved user is the request's `creator` for all downstream logic.

## Request / response contract

`POST /api/public/tasks`

```jsonc
{
  "title": "Launch landing page",   // required, non-empty
  "description": "optional details", // optional
  "dueDate": "2026-07-15",           // optional — ISO date (YYYY-MM-DD) or datetime
  "boardId": "clx8f3k2",             // optional — a board id from GET /api/public/boards
  "assignTo": "me",                  // optional — "me" | omitted (unassigned)
  "subtasks": [                      // optional
    { "title": "Wireframe" },
    { "title": "Copy", "dueDate": "2026-07-12" }
  ]
}
```

Validated with Zod. Unknown top-level fields are rejected (`.strict()`).

Success `201`:

```jsonc
{
  "id": "clx…",
  "title": "Launch landing page",
  "board": { "id": "clb…", "name": "Marketing" },  // or null
  "dueDate": "2026-07-15T00:00:00.000Z",           // or null
  "assignees": [ { "id": "clu…", "name": "…" } ],  // [] when unassigned
  "subtasks": [ { "id": "cls…", "title": "Wireframe" } ],
  "url": "https://<app>/user/tasks?taskId=clx…"
}
```

Errors: `400` (validation / unknown board / ambiguous board), `401` (auth), `500`.

## Field mapping & rules

- `creator` = token owner (always).
- `assignTo: "me"` → assignee set to owner via `setTaskAssignees([owner.id])`.
  Omitted → `setTaskAssignees([])` (unassigned).
- `priority` = `MEDIUM` (hardcoded; not a request field).
- `status` = `TODO` (default).
- `dueDate` accepts `YYYY-MM-DD` or full ISO datetime; date-only is stored at
  `T00:00:00.000Z`. `startDate` mirrors the existing UI behavior (auto-set to dueDate).
- **Board resolution:** the given `boardId` must belong to a board the caller
  **owns or is a member of** (`KanbanBoard.ownerId == user.id` OR a
  `KanbanBoardMember` row for the user).
  - Unknown id, or a board the caller can't access → `400 { error: "Board not found or not accessible. Call GET /api/public/boards." }` (same message for both, to avoid leaking which board ids exist).
  - Valid → inherit `teamId` via `resolveTeamBoardLink`. The existing team-board
    membership check still runs; it always passes because we only accept the caller's
    own boards.
- No `boardId` → `boardId = null`, `teamId = null` (backlog/unassigned).
- **Subtasks:** each becomes a child `Task` with `parentId = parent.id`, same
  `boardId`/`teamId` as the parent, `priority = MEDIUM`, `status = TODO`, optional
  own `dueDate`. Parent + all subtasks created in **one `prisma.$transaction`** —
  all-or-nothing.

## Token-management UI

A card on `src/app/user/profile/page.tsx`, "API Tokens":
- List of the user's tokens: `name`, `createdAt`, `lastUsedAt`, Revoke button.
- "Generate token" → prompts for a name → shows the raw token once in a copyable
  box with a clear "you won't see this again" warning.
- Revoke → `DELETE`, soft-deletes (sets `revokedAt`), row disappears from the list.

## Security

- Bearer required on `/api/public/tasks` and `/api/public/boards`.
  `/api/public/openapi.json` is public (spec only, contains no user data).
- Zod `.strict()` validation; reject unknown fields.
- Tokens stored hashed (SHA-256); constant-time comparison via hash lookup.
- Best-effort per-token rate limit (reuse the existing login rate-limit utility if
  one exists; otherwise a simple in-memory guard, documented as best-effort — a
  future hardening item, not a v1 blocker).
- No privilege escalation: the agent can only do what its owner could — post to the
  owner's boards, assign only to the owner.
- Token-management routes are session-authenticated and scoped to the caller's own
  tokens (a user can never see or revoke another user's tokens).

## Testing / verification

- Integration test against the running app (Node script hitting the real endpoints):
  1. Valid token creates a task with 2 subtasks → `201`, correct shape, rows in DB.
  2. Missing / malformed / revoked token → `401`.
  3. Valid `boardId` places the task on that board; unknown/inaccessible board id → `400`.
  4. `assignTo: "me"` → owner in `assignees`; omitted → `assignees: []`.
  5. Task created with `priority = MEDIUM`, `status = TODO`, `creator = owner`.
- `docs/public-api.md` with curl examples and the OpenAPI import instructions.

## Migration & rollout

- `ApiToken` model → `npm run db:migrate` (dev) then apply on staging and prod.
  Note in project memory that this migration is pending on staging/prod.
- No breaking changes to existing tables (additive only).

## Open questions

None — all design decisions confirmed with the user.
