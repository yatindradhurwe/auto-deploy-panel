# Architecture

## Overview

```
 Browser (React SPA, frontend/dist)
   │  every /api/ request carries Authorization: Bearer <JWT> and X-Server-Id: <selected server>
   ▼
 nginx ──► /api/ ──► Express backend (127.0.0.1:4040, PM2: auto-deploy-panel)
                        │
                        ├─ middleware: authenticateToken → requireTenant → (requireSystemAdmin) → requireIdempotency
                        ├─ routes/*  ──►  services/*
                        │                    │
                        │                    └─ host executor (services/host.service.js)
                        │                          ├─ LocalHost  → child processes + fs on the panel machine
                        │                          └─ RemoteHost → pooled SSH connection + SFTP per server
                        └─ backend/data/db.json (users, orgs, servers, projects, settings, logs)
```

## Request flow

1. **Authentication** (`middleware/auth.middleware.js`) verifies the JWT (signed with `JWT_SECRET`). Tokens may also arrive as `?token=` for `EventSource` streams.
2. **Tenant & server** (`middleware/tenant.middleware.js`) resolves the organization (header `X-Organization-Id`, query, body, or the user's default), checks membership, and resolves the **selected server** from `X-Server-Id` (falling back to the organization's first server). The result is `req.tenant = { organizationId, server, serverId, memberRole }`.
3. **Admin gate**: `/api/studio/*` (project tools that execute commands) requires a system admin.
4. **Idempotency** (`middleware/idempotency.middleware.js`): mutating requests that send an `Idempotency-Key` header are de-duplicated.

## The host executor

`services/host.service.js` is the core of multi-server support. `getHost(server)` returns an executor with the same API for every server:

| Method | Purpose |
|---|---|
| `exec(script, { cwd, timeout, input, onData, signal })` | Run a bash script; returns `{ code, stdout, stderr }`. |
| `run(cmd, args, opts)` | Same, with every argument single-quoted. |
| `readFile`, `writeFile`, `stat`, `lstat`, `readdir`, `exists`, `realpath`, `mkdir`, `rm`, `rename` | File operations. |
| `putFile`, `fetchFile` | Copy a local file to / from the server (SFTP for remote). |

- **Local vs remote**: `isLocalServer(server)` treats `null`, loopback addresses, the machine's own interface addresses and `PANEL_PUBLIC_IP` as the panel host.
- **Scripts never pass through argv**: each script is written to a private (mode 600) temp file and run with `bash`, so secrets in it (database passwords, tokens) do not appear in `ps`. Remote scripts travel base64-encoded.
- **Stop / timeouts**: remote scripts run in their own process group (`setsid`); aborting kills the whole group on the server.
- **Pooling**: one SSH connection per server (keep-alive, closed after 5 idle minutes), at most 4 concurrent channels, retry when the server's `MaxSessions` limit is hit. Editing or deleting a server drops its pooled connection.
- **Credentials** come from the server record in `db.json` and never leave the backend: `publicServer()` strips passwords, keys and tokens from every API response.

## Services

| Service | Responsibility |
|---|---|
| `host.service.js` | Executors, local/remote detection, connection test, credential stripping. |
| `project-discovery.service.js` | One-script discovery of a server's projects: `/var/www/*`, `/home/*/htdocs/*`, PM2 working dirs, nginx `server_name` / `root` / `proxy_pass`, Git remote and branch, `.env` `PORT`. |
| `server.service.js` | Live metrics (CPU, RAM, disk, OS, uptime), PM2 process list, certbot certificates, crontab. |
| `project-ops.service.js` | Update a project from Git (pull, install, build, reload) and delete a project (PM2, nginx, database, files) with validated, quoted input. |
| `detector.service.js` | Stack detection from a file listing + manifests (see below). |
| `upload.service.js` | Chunked uploads, archive extraction (zip-slip / symlink safe), database dump sniffing, shallow Git clone analysis. |
| `deploy-pipeline.service.js` | The 11-stage deployment pipeline with weighted progress events. |
| `database.service.js` | Database discovery and browsing through each engine's CLI on the selected server. |
| `mail.service.js` | Domain mailboxes: Postfix/Dovecot/OpenDKIM maps, DNS checks, Maildir webmail, delivery log. |
| `project-agent.service.js` + `agent-providers.js` | The AI coding agent loop and the Claude / OpenAI / Gemini adapters. |
| `autoupdate.service.js` | Periodic and webhook-triggered Git updates of deployed projects. |
| `db.service.js` | JSON data store (users, organizations, servers, projects, settings, audit logs). |

## Stack detection

`detector.service.js` works on real files, so an uploaded archive, a GitHub checkout and a folder on a server give the same answer:

1. Root manifests win over nested ones; a root `package.json` that only orchestrates sub-projects (workspaces, `concurrently`, `cd frontend && …`) is treated as a wrapper.
2. `frontend/`, `client/`, `web/` … and `backend/`, `server/`, `api/` are checked for monorepos; a SPA plus a Node API becomes a **full-stack** plan (static files + `/api` proxy).
3. Node projects are classified by dependencies: Next.js / Nuxt / Remix / SvelteKit-node / Astro-node (SSR), Express / Fastify / NestJS / Koa / hapi / Hono (server), Vite / CRA / Vue CLI / Angular / Gatsby / Svelte (SPA, with the real output folder, e.g. `vite.config` `outDir` or `angular.json` `outputPath`).
4. PHP (Laravel, WordPress, Symfony, Composer, plain), Python (Django with its WSGI module, Flask / FastAPI with the app object found in the source), Go, Java (Maven/Gradle), Ruby (Rails/Rack), static HTML.
5. Database hints come from dependencies, Prisma schema, `.env.example` and SQL dumps in the source.
Every decision is explained in an `evidence` list shown in the wizard.

## Deployment pipeline

Stages and their progress weights: connect 4 · source 12 · analyze 4 · database 10 · env 3 · install 26 · build 18 · service 8 · webserver 6 · ssl 6 · verify 3. Long stages advance as output arrives (never past 92 % of the stage) so the percentage is honest. Events streamed over SSE:

```js
{ kind: 'stage', id, status: 'running'|'done'|'skipped'|'warning'|'failed', label, detail }
{ kind: 'log', stage, text, isError }
{ kind: 'progress', percent }
{ kind: 'plan', plan }
{ kind: 'result', status: 'success'|'failed', url, summary | error }
```

Safety: every wizard value is validated (`validateDeployConfig`), shell values are single-quoted, files are written base64-encoded, the previous version is kept as `<dir>.previous-<timestamp>`, an existing `.env` is preserved, a domain owned by another site is never overwritten (nginx configs carry an `# autodeploy:<app>` marker), `nginx -t` failures roll back, and a crash right after start is reported with the PM2 log.

## AI agent

A streaming tool-use loop shared by three providers. Every model gets the same two tools:

- `str_replace_based_edit_tool` — view / create / str_replace / insert (Claude uses the Anthropic-defined `text_editor_20250728`; ChatGPT and Gemini get an equivalent JSON-schema function).
- `bash` — one allowlisted command, run without a shell (no pipes, `&&`, redirects, globs); programs are limited to read-only tools, read-only `git`, `npm`/`npx` (known tools only, `--no-install`), `node` scripts, syntax checkers and `curl` to localhost.

Paths are confined to the project root on the project's server (symlinks resolved there). Each changed file is backed up locally before its first change; the review screen diffs backup vs. current content, and revert restores it. Deploy (commit + PM2 restart) is a separate user action. Conversations are stored in `backend/data/agent-sessions/` and keep the provider/model and server they started with.

## Data storage

`backend/data/` (git-ignored) holds:

| Path | Contents |
|---|---|
| `db.json` | Users, organizations, members, servers (with SSH credentials), projects, plans, subscriptions, settings, audit and webhook logs, email domains and accounts. |
| `.jwt_secret` | Generated JWT signing secret when `JWT_SECRET` is not set. |
| `.anthropic_api_key`, `.openai_api_key`, `.gemini_api_key`, `agent-settings.json` | AI agent keys and model choices. |
| `agent-sessions/` | Agent conversations and file backups. |
| `uploads/` | Uploaded project archives and database files (deleted after 24 h). |

## Frontend

- `CustomerDashboardLayout.jsx` owns the server list and the selected server; switching servers remounts the workspace so every screen reloads for that server.
- `utils/activeServer.js` remembers the selection (localStorage) and adds `X-Server-Id` to every `/api/` request made with `fetch` or `XMLHttpRequest`.
- Main screens: `AllProjectsHub`, `ProjectDedicatedStudio` (with `ProjectAgentPanel`, `CodeStudio`, `DatabaseManager`, `EnvManager`, `LogsTelemetryManager`, `GitSyncWorkspace`), `DeploymentWizard`, `EmailManager`, `ServerConnectLanding` / `ServerSelectorDropdown`, and the `admin/` console.
