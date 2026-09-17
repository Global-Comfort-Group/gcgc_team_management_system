# Local-server deployment config — copies of record

**These are copies, not the live files.** Editing anything here changes nothing on the
server. Captured from `/opt/gcgc-tms` on `10.100.100.86` on 17 September 2026.

## ⚠️ The rest of this directory describes a topology that is not running

`deployment/` already contains `deploy-production.sh`, `nginx-production.conf`,
`pm2.production.config.js`, `server-setup.sh` and friends. That is a **pm2 + nginx**
deployment from the app's earlier Railway / Alibaba ECS life.

**The live server runs podman-compose + Caddy.** Do not read those files as a description
of `10.100.100.86`. The files carrying the `.local-server` suffix, and the ones added
here, are the ones that describe the box actually in production.

## What runs on `.86`

Four containers under **root** podman — not rootless:

| Service | Image |
|---|---|
| `gcgc-tms_db_1` | `postgres:17` |
| `gcgc-tms_redis_1` | `redis:7` |
| `gcgc-tms_app_1` | built from `Dockerfile.local-server` |
| `gcgc-tms_caddy_1` | `caddy:2`, ports 80/443 |

Because they run as root, `podman ps` as `aidev` returns **empty**. That is a permissions
artefact, not an outage. Container commands need `sudo`.

## Contents of this set

| File here | Live path on `.86` | Notes |
|---|---|---|
| `docker-compose.local-server.yml` | `docker-compose.yml` | The whole 4-service stack |
| `Dockerfile.local-server` | `Dockerfile` | `node:20-bookworm-slim`; `npm ci`, then `prisma generate && next build` |
| `dockerignore.local-server` | `.dockerignore` | Renamed — a functional `.dockerignore` must sit beside its build context, and this is a copy of record, not a working file |
| `Caddyfile.local-server` | `Caddyfile` | Already tracked; refreshed here to match the live file |
| `update.sh.local-server` | `update.sh` | Already tracked and **already current** — byte-identical to the server, no change needed |

## The database is local, whatever `.env` says

`/opt/gcgc-tms/.env` carries comments reading `# Database (Alibaba Cloud RDS PostgreSQL)`
and names an external instance. **Those comments are a stale leftover from the Railway/ECS
era.** The live database is the local `gcgc-tms_db_1` container. Verified three ways:

- the `DATABASE_URL` host portion is `db` — the compose service name
- the app container's effective `DATABASE_URL` host is also `db`
- no established outbound connections to `:5432` exist, and the local database shows
  698,075 commits of real write activity

Read the value, not the comment.

## Line endings are pinned, deliberately

`deployment/.gitattributes` forces LF on the scripts and configs here. Without it, a
Windows checkout rewrites them to CRLF — and `update.sh.local-server` is a `#!/bin/bash`
script, so a CRLF copy placed on the server fails with
`bad interpreter: /bin/bash^M`. A checkout of this repo on Windows before that pin was
added produced 186 CR bytes in that file.

## What is deliberately NOT here

- **`.env`** — live database credentials and application secrets. Correctly gitignored and
  must never enter this repository, which is **public**. It needs its own protected
  storage.
- **`public/uploads/`** — user-uploaded files. Data, not config. Small (2 files) but it is
  the only copy.
- **`backups/`** — accumulated manual database dumps. Back up the live database instead.
- **`*.bak*` files** — `Caddyfile.bak-before-catchall`, `update.sh.bak-fix-ssh` and others.
  They are hand-made history, superseded by this directory now being under version
  control.

## Applying anything from here

These are copies. To change the server, edit the live file on `.86` and then update the
copy here — or better, make this directory authoritative and have the deploy script read
from it. Until that happens, **the server is authoritative** and these copies can drift.
