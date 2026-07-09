# Public Task API

A token-authenticated HTTP API for creating tasks (and subtasks) from an external
agent / LLM. Hand the token and the OpenAPI spec to your agent framework and it can
create tasks from natural-language prompts.

## Getting a token

1. Log in to the TMS → **Profile → Account tab → API Tokens**.
2. Click **Generate token**, give it a name (e.g. `my-agent`).
3. Copy the token immediately — it's shown **once** and cannot be retrieved later.
   (Only a hash is stored; if you lose it, revoke and generate a new one.)
4. Revoke any token anytime from the same card.

Every task the token creates is owned by **you** (the token's user).

## Authentication

Send the token as a Bearer header on every request:

```
Authorization: Bearer gcgc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Endpoints

Base URL = your TMS origin (e.g. `https://tms.example.com`).

### `GET /api/public/openapi.json`
Public OpenAPI 3.1 spec. Import it into your agent framework (LangChain, custom
GPTs, OpenAI/Anthropic tool-calling, n8n, etc.) to auto-generate the tool. No auth.

### `GET /api/public/boards`
Lists the boards you can create tasks on. Use an `id` from here as `boardId`.

```bash
curl -H "Authorization: Bearer $TOKEN" https://tms.example.com/api/public/boards
# { "boards": [ { "id": "clx8f3k2…", "name": "Marketing" } ] }
```

### `POST /api/public/tasks`
Create a task, optionally with nested subtasks.

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Task title |
| `description` | no | Free text; can also be filled in later in the app |
| `dueDate` | no | `YYYY-MM-DD` or full ISO datetime |
| `boardId` | no | A board id from `GET /api/public/boards`. Omit → task has no board (you can drag it onto a board in the app) |
| `assignTo` | no | `"me"` assigns the task to you; omit → unassigned |
| `subtasks` | no | Array of `{ title, description?, dueDate? }` (max 50). Created atomically with the parent |

```bash
curl -X POST https://tms.example.com/api/public/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Launch landing page",
    "dueDate": "2026-07-20",
    "boardId": "clx8f3k2",
    "assignTo": "me",
    "subtasks": [
      { "title": "Wireframe" },
      { "title": "Copy", "dueDate": "2026-07-18" }
    ]
  }'
```

Response `201`:

```json
{
  "id": "cmr…",
  "title": "Launch landing page",
  "board": { "id": "clx8f3k2", "name": "Marketing" },
  "dueDate": "2026-07-20T00:00:00.000Z",
  "assignees": [ { "id": "cme…", "name": "Kyle" } ],
  "subtasks": [ { "id": "cs1…", "title": "Wireframe" }, { "id": "cs2…", "title": "Copy" } ],
  "url": "https://tms.example.com/user/tasks?taskId=cmr…"
}
```

## Behavior & defaults

- **Priority** is always `MEDIUM` on creation; change it later in the app.
- **Status** is always `TODO`.
- **Subtasks** inherit the parent's board/team and `assignTo` setting.
- Parent + subtasks are created in a single transaction (all-or-nothing).

## Errors

| Status | Meaning |
|--------|---------|
| `400` | Validation error, unknown field, or unknown/inaccessible `boardId` |
| `401` | Missing, malformed, revoked, or unknown token |
| `429` | Rate limit exceeded (60 requests/min per token) — retry after `Retry-After` |

## Notes

- The API can only do what you can: post to your own boards, assign only to yourself.
- Board access = boards you own or are a member of.
