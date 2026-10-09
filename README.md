# AutoDeploy Panel

A self-hosted control panel for running websites and web apps on your own Linux servers. Connect one or more servers over SSH, then deploy, edit, inspect and operate every project on them from the browser — including an AI coding agent that can change a project for you.

## Features

| Area | What it does |
|---|---|
| **Multi-server** | Connect any number of Linux servers over SSH. Pick one in the server menu and every screen — projects hub, project studio, databases, logs — works on that server. Live CPU / RAM / disk and reachability per server. |
| **Projects hub** | Discovers the projects on the selected server automatically: folders in `/var/www` and `/home/*/htdocs`, PM2 apps, and the nginx domains that point at them. |
| **Project studio** | Live preview, code editor and file manager, terminal, `.env` editor, Git (status / pull / push / history / rollback), PM2 control and logs, nginx and SSL, cron, database browser — all on the project's own server. |
| **1-click deploy** | Deploy from GitHub (public or private) or an uploaded `.zip` / `.tar.gz`. Detects the stack from the real files (static, React/Vite/Angular SPA, Next.js/Nuxt, Express/NestJS, full-stack monorepo, PHP/Laravel/WordPress, Python, Go, Java, Ruby), optionally creates or imports a database, configures nginx and HTTPS, and shows step-by-step progress with a percentage. |
| **Databases** | Finds every PostgreSQL, MySQL, MongoDB, Redis and SQLite database used by the server's projects (from their `.env` files and from the database servers), with table browsing, search, a query console, and row/table editing. |
| **Domain email** | Real mailboxes on your own domains (Postfix + Dovecot + OpenDKIM): IMAP/POP3/SMTP for mail apps, built-in webmail, DKIM keys, a live DNS checker and a delivery log. |
| **AI project agent** | A Claude Code-style agent (Claude, ChatGPT or Gemini) that reads the project, edits files, runs builds/tests to verify, and shows a reviewable diff. Every change can be reverted; deploying is a separate click. |
| **SaaS & admin** | Accounts, organizations and team roles, plans and billing records, a super-admin console, audit logs, and idempotent API requests. |

## Tech stack

- **Backend:** Node.js (ES modules), Express, `ssh2`, official Anthropic / OpenAI / Google GenAI SDKs, `nodemailer` + `mailparser`. Data is stored in a JSON file (`backend/data/db.json`).
- **Frontend:** React 18, Vite, Tailwind CSS, lucide-react icons.
- **On the servers:** bash and standard Linux tools; PM2, nginx and certbot for app hosting; database CLIs (`psql`, `mysql`, `mongosh`, `redis-cli`, `sqlite3`) for the database browser.

## Quick start

Requirements: a Linux server (Ubuntu 22.04/24.04 recommended), Node.js 20+, npm, nginx, PM2, and root access.

```bash
git clone https://github.com/yatindradhurwe/auto-deploy-panel.git /var/www/auto-deploy-panel
cd /var/www/auto-deploy-panel

# Backend
cd backend && npm install && cd ..

# Frontend (built once; nginx serves frontend/dist)
cd frontend && npm install && npm run build && cd ..

# Create the first admin login (prompts for the password)
node backend/scripts/set-admin-password.js admin@example.com

# Run the API under PM2 (listens on 127.0.0.1:4040)
pm2 start backend/server.js --name auto-deploy-panel
pm2 save
```

Point an nginx site at `frontend/dist` and proxy `/api/` to `127.0.0.1:4040` — see [docs/OPERATIONS.md](docs/OPERATIONS.md#nginx) for a complete config, HTTPS, and the optional mail server.

## Configuration

All settings are optional environment variables for the backend process.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `4040` / `127.0.0.1` | Where the API listens. Keep it on localhost behind nginx. |
| `JWT_SECRET` | random, stored in `backend/data/.jwt_secret` | Signs login tokens (min. 32 chars). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Bootstraps the system admin on first login (prefer `set-admin-password.js`). |
| `PANEL_PUBLIC_IP` | `187.127.165.128` | The panel host's public IP, so it recognises itself as a local server. **Set this on your install.** |
| `PANEL_PM2_NAME` | `auto-deploy-panel` | PM2 name of the panel (protected from being stopped from the UI). |
| `GITHUB_WEBHOOK_SECRET` | — | Verifies GitHub push webhooks (`/api/webhooks/github/:appName`). |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | AI agent keys (can also be set in the agent's settings screen). |
| `MAIL_HOST` | name on the Dovecot certificate | Hostname mail clients connect to. |
| `AUTODEPLOY_DB_PATH` | `backend/data/db.json` | Alternative data file (used by tests). |

## Documentation

- [User guide](docs/USER_GUIDE.md) — servers, projects, deploying, databases, email, the AI agent
- [Architecture](docs/ARCHITECTURE.md) — how the backend, frontend and servers fit together
- [API reference](docs/API.md) — every endpoint
- [Operations](docs/OPERATIONS.md) — installation, nginx, mail server setup, security, backups, troubleshooting

## Project layout

```
backend/
  server.js                 Express app, middleware wiring, health + GitHub webhook
  routes/                   auth, studio (project tools), deploy, agent (servers), admin, team, billing
  services/                 host executor, discovery, deploy pipeline, databases, mail, AI agent, …
  middleware/               JWT auth, tenant/server resolution, idempotency
  scripts/                  set-admin-password.js, setup-mail-server.sh
  data/                     db.json, secrets, uploads, agent sessions (git-ignored)
frontend/
  src/components/           React screens (hub, studio, wizard, managers, admin)
  src/utils/                API client, active-server header
docs/                       Documentation
```

## License

Private project — all rights reserved.
