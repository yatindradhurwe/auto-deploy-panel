# API reference

Base URL: `/api` (proxied by nginx to the backend on `127.0.0.1:4040`).

## Conventions

| Header | Meaning |
|---|---|
| `Authorization: Bearer <JWT>` | Required on everything except `auth/signup`, `auth/login`, `health`, webhooks and the agent installer. `EventSource` streams may pass `?token=` instead. |
| `X-Server-Id: <server id>` | The server a request targets. The frontend adds it to every request automatically; without it the organization's first server is used. |
| `X-Organization-Id` | Organization to act in (defaults to the user's own). |
| `Idempotency-Key` | Optional on mutating requests; repeats with the same key return the first result. |

Responses are JSON. Errors: `{ success: false, error: "<readable message>" }` with a 4xx/5xx status.

Access levels: **user** = any logged-in member; **admin** = system admin. All `/api/studio/*` routes are **admin**.

## Health & webhooks
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Status and last code update time. |
| POST | `/webhooks/github/:appName` | GitHub push webhook (verified with `GITHUB_WEBHOOK_SECRET`); triggers auto-update. |
| POST | `/deploy/webhook/:projectId` | Generic Git push webhook with de-duplication. |

## Auth — `/api/auth`
`POST /signup`, `POST /login`, `GET /me`, `POST /onboarding`, `GET|POST /settings`, `POST /logout`, `GET /platform-status`.

## Servers
### Customer API — `/api/agent` (user)
| Method | Path | Notes |
|---|---|---|
| GET | `/servers` | The organization's servers, without credentials (`hasPassword`, `hasSshKey`, `isLocal` flags instead). |
| POST | `/servers` | Add a server. VPS servers are only saved after a successful SSH login. Body: `name, ipAddress \| hostname, port, username, password \| sshKey, domain, serverType`. |
| DELETE | `/servers/:id` | Remove a server of your organization. |
| GET | `/install.sh`, POST `/register`, POST `/heartbeat` | Lightweight monitoring agent. |

### Admin API — `/api/studio`
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/servers` | All servers with live `status` (`online`/`offline` + `error`), `cpu`, `ram`, `disk`, `activeApps`. |
| POST | `/servers/test` | Check SSH credentials without saving. Returns OS, cores, Node/PM2/nginx presence. |
| POST | `/servers/add` | Test, then save a server. |
| POST | `/servers/update` | `{ serverId, name?, ipAddress?, port?, username?, password?, sshKey? }` — re-tested if the login changes. |
| POST | `/servers/delete` | `{ serverId }` — disconnects (the panel host cannot be removed). |
| POST | `/servers/scan` | Fresh metrics + PM2 processes for the selected server. |
| GET/POST | `/server-metrics` | Metrics + PM2 processes for the selected server. |

## Projects & tools — `/api/studio` (admin, selected server)
| Method | Path | Body / notes |
|---|---|---|
| GET/POST | `/projects`, `/projects/realtime-fetch` | Projects discovered on the server (`name, path, domain, port, gitUrl, branch, pm2Processes, status, serverId`). |
| POST | `/projects/delete` | `{ appName, projectPath, domain, dbName, deletePm2, deleteNginx, deleteDb, deleteFiles }` |
| POST | `/files/tree` | `{ projectPath }` → nested tree (skips `node_modules`, `.git`, `dist`). |
| POST | `/files/read`, `/files/save` | `{ projectPath, filePath, content? }` (editor limit 10 MB). |
| POST | `/files/create` | `{ projectPath, relativePath, type: 'file'\|'folder' }` |
| POST | `/files/delete` | `{ filePath }` (system and top-level folders refused). |
| POST | `/files/upload` | `{ projectPath, targetDir, files: [{ relativePath, contentBase64 \| content }] }` |
| POST | `/terminal/exec` | `{ projectPath, command }` → `{ output, exitCode }` (120 s limit). |
| POST | `/env/get`, `/env/save` | `{ projectPath, rawContent? \| envVars? }` |
| POST | `/git/status`, `/git/history` | `{ projectPath }` |
| POST | `/git/pull`, `/git/push` | `{ projectPath, branch, commitMessage? }` |
| POST | `/git/rollback` | `{ projectPath, commitHash }` |
| POST | `/git/pull-and-update` | `{ projectPath, appName, branch }` — pull, install, build, reload; returns logs. |
| POST | `/pm2/control` | `{ action: start\|restart\|reload\|stop\|delete, appName \| processId }` |
| POST | `/pm2/logs` | `{ appName, lines }` |
| POST | `/nginx/config` | `{ domain, proxyPort }` — rolled back if `nginx -t` fails. |
| POST | `/ssl/issue` | `{ domain, email }` (certbot). |
| GET/POST | `/ssl/certificates`, `/cron/list` | Certificates with real expiry; crontab entries. |
| POST | `/cron/save` | `{ schedule, command }` |
| GET | `/preview-proxy?url=` | Frame-friendly proxy for the live preview. |
| GET/POST | `/autoupdate/config/:appName`, `/autoupdate/config`, `/autoupdate/trigger-now`, `/autoupdate/list`, `/autoupdate/history` | Git auto-update settings and history. |

## Databases — `/api/studio/databases` (admin, selected server)
| Method | Path | Body |
|---|---|---|
| GET/POST | `/databases` | `{ refresh? }` → `{ projects: [{ name, path, databases }], unassigned, engines, errors }`. Each database has an opaque `id` (credentials stay on the server). |
| POST | `/databases/tables` | `{ connectionId }` |
| POST | `/databases/table-data` | `{ connectionId, schema, table, page, pageSize, search }` |
| POST | `/databases/query` | `{ connectionId, query }` |
| POST | `/databases/insert-row`, `/delete-row` | `{ connectionId, schema, table, row \| where }` |
| POST | `/databases/create-table`, `/drop-table` | `{ connectionId, schema, table, columns? }` |

## 1-click deploy — `/api/deploy` (user, selected server)
| Method | Path | Notes |
|---|---|---|
| POST | `/analyze-git` | `{ gitUrl, branch }` → `{ analysis, branch, requestedBranchMissing }` (shallow clone; saved GitHub token used for private repos). |
| POST | `/uploads` | `{ kind: 'source'\|'database', name, size }` → `{ uploadId, chunkSize }` |
| POST | `/uploads/:id/chunk?offset=N` | Raw bytes (`application/octet-stream`). A wrong offset returns 409 with `expectedOffset`. |
| POST | `/uploads/:id/complete` | Source: extracts and returns `analysis`. Database: returns `engine` and `format`. |
| POST | `/deploy` | `{ appName, domain, source: { type: 'github', gitUrl, branch } \| { type: 'upload', uploadId }, envVars, port?, overrides?, database: { mode: 'none'\|'create'\|'import', engine, uploadId?, adminUser?, adminPassword? }, ssl, sslEmail, replaceDomain }` → `{ deployId, stages }` |
| GET | `/stream/:deployId` | Server-Sent Events: `stage`, `log`, `progress`, `plan`, `result` (replayed on reconnect). |
| GET/POST | `/get-github-token`, `/save-github-token`, `/github-repos` | GitHub connection. |
| POST | `/detect-stack` | Back-compat alias of `analyze-git`. |

## Domain email — `/api/studio/email` (admin)
`GET /status`, `GET /client-config`, `GET|POST /domains`, `POST /domains/update` (catch-all), `POST /domains/delete`, `GET /domains/dns?domain=`, `GET /accounts`, `POST /accounts/create|update|delete`, `GET /messages?mailbox=&folder=&page=&search=`, `GET /message?mailbox=&folder=&id=`, `GET /attachment?…&index=`, `POST /read-mark`, `POST /messages/delete`, `POST /send` (`{ from, to, cc, subject, text, attachments: [{ filename, contentType, contentBase64 }] }`), `GET /delivery-log?address=`.

## AI agent — `/api/studio/ai/agent` (admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/status` | Providers (`claude`, `openai`, `gemini`) with `configured`, `keyHint`, `model`; `defaultProvider`. |
| POST | `/settings` | `{ provider, apiKey?, model?, makeDefault? }` (empty `apiKey` removes the stored key). |
| GET | `/sessions?projectPath=` | Conversations for a project on the selected server. |
| POST | `/sessions` | `{ projectPath, projectName, provider }` |
| GET | `/sessions/:id` | Transcript, changed files, usage. |
| POST | `/sessions/:id/message` | `{ prompt }` → Server-Sent Events: `text_delta`, `thinking_delta`, `tool_pending`, `tool_start`, `tool`, `assistant`, `thinking`, `error`, `done`. |
| POST | `/sessions/:id/stop`, `/sessions/:id/delete` | |
| GET | `/sessions/:id/changes` | Unified diff per changed file. |
| POST | `/sessions/:id/revert` | `{ file? }` — one file or all. |
| POST | `/sessions/:id/deploy` | `{ commit, commitMessage }` — optional Git commit, then PM2 restart. |

## Admin, team, billing
- `/api/admin` (admin): `overview`, `users` (+ `suspend`, `activate`, `reset-password`, `revoke-sessions`, `impersonate`, delete), `organizations` (+ `plan`, `suspend`, `activate`, members `role`, delete), `servers`, `subscriptions`, `plans` (CRUD), `settings`, `audit-logs`, `idempotency/stats|records`.
- `/api/team`: `GET /members`, `POST /invite`, `PUT /members/:userId/role`, `DELETE /members/:userId`, `GET /audit-logs`.
- `/api/billing`: `GET /summary`, `GET /plans`, `POST /checkout`, `POST /cancel`, `POST /webhook`.
