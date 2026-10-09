# User guide

## Servers

### Connect a server
1. Open the **server menu** at the top (or **Change server** on the projects hub) and choose **Connect Server**.
2. Enter a name, the server's IP address or hostname, the SSH port (usually 22), the SSH user (usually `root`) and either the **password** or a **private SSH key**.
3. The panel logs in once to check the credentials before saving. If the login is rejected you see why (wrong password, port closed, unreachable host).

Credentials are kept on the panel's backend and are never sent back to the browser. An SSH key is safer than a password.

### Switch servers
Pick a server in the server menu. The choice is remembered, and every screen reloads for that server: the projects hub, studio, databases, environment, logs, SSL, cron and deployments. An open project studio closes when you switch, because the project belongs to the previous server.

Each server shows live status — **online** with CPU, RAM, disk and running apps, or **unreachable** with the reason.

### What a connected server needs
bash and standard Linux tools. For full functionality: Node.js + PM2 (running apps), nginx (domains), certbot (HTTPS), Git, and the database CLIs your apps use. Missing tools are reported clearly when a feature needs them.

## Projects hub
Lists the projects found on the selected server: folders in `/var/www` and `/home/*/htdocs`, apps running under PM2, and the domains nginx serves for them. Projects deployed through the panel appear with their recorded name and domain. Open a project to enter its studio.

## Project studio
Everything runs on the server the project lives on (shown in the studio header).

| Tab | What you can do |
|---|---|
| **Preview** | The live site in desktop or mobile frame (with a proxy mode for sites that block framing). |
| **Code** | File tree, editor, create / upload / delete files, terminal in the project folder. |
| **Database** | The project's databases — see [Databases](#databases). |
| **Env** | Edit the project's `.env` (`.env`, `.env.production` or `.env.local`, whichever exists). |
| **Logs** | PM2 output and error logs. |
| **Git** | Status, pull, commit & push, history, roll back to a commit, pull-and-update (pull, install, build, reload). |
| **Settings** | Project settings, domain/SSL, delete project. |

Deleting a project can remove its PM2 process, nginx site, database and files; the panel's own folder and system folders are always protected.

## AI project agent
The left panel of the studio (and the agent drawer in Code Studio).

1. **Connect a model** — click the gear and add an API key for **Claude** (console.anthropic.com), **ChatGPT** (platform.openai.com) or **Gemini** (aistudio.google.com/apikey). One is enough; you can change the model name and the default provider there.
2. **Ask for a change** — e.g. "Change the hero heading to …", "Add a contact form", "The login page is blank — fix it". The agent reads the code, edits files, and runs the project's build / type-check / tests to verify. You see its reasoning (Claude, Gemini), each file it opens or edits and each command with its output.
3. **Review** — every changed file with a diff; revert one file or all of them.
4. **Deploy** — optionally commit the changed files to Git, then restart the project's PM2 app. Static sites that the agent rebuilt are live immediately.

**Stop** interrupts the agent at any time. Conversations are saved per project and server; a conversation keeps the model it started with (start a new one to switch). Cost is shown for Claude; ChatGPT and Gemini show token counts.

What the agent cannot do: edit outside the project folder, `.git` or `node_modules`; use pipes or arbitrary programs; restart, stop or deploy apps; run `git commit/push`. Note that builds and `npm install` execute the project's own scripts.

## 1-click deploy
Opens from **1-Click Deploy** and deploys to the **selected server** using its saved login.

1. **Source**
   - **GitHub** — pick one of your repositories (connect a token for private repos) or paste any Git URL and branch, then **Analyze**. A missing branch falls back to the default branch.
   - **Upload project** — drop a `.zip`, `.tar.gz`, `.tgz` or `.tar` (up to 2 GB; leave out `node_modules`). Uploads go in 8 MB chunks and resume after network hiccups. A single wrapping folder (as in GitHub's *Download ZIP*) is removed automatically.
2. **App** — the detected stack with the evidence behind it, the app name (installed in `/var/www/<name>`), the domain, and extra environment variables. **Advanced** lets you override the app type, build/start commands, output folder, app folder or port.
3. **Database** (optional)
   - **Create new database** — PostgreSQL, MySQL/MariaDB, MongoDB or SQLite; a database and user with a random password are created.
   - **Upload database file** — `.sql` / `.sql.gz` (MySQL or PostgreSQL, detected automatically), `.dump` (pg_dump custom format) or `.sqlite` / `.db`; it is imported into the new database.
   - Connection settings (`DATABASE_URL`, `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `MONGODB_URI`, …) are added to the app's `.env`. If MySQL's admin login needs a password, enter it under the MySQL admin option.
4. **Launch** — HTTPS via Let's Encrypt (requires the domain's DNS A record to point at the server), a summary, and **Deploy**.

The progress screen shows the current step and its details, a percentage, the remaining time, a checklist of the 11 steps and an expandable log. On success you get the live URL and the database credentials; on failure, the reason, the step it failed in, and **Try again**.

Redeploying the same app keeps the previous version as `/var/www/<app>.previous-<timestamp>` and keeps the existing `.env`. A domain already used by another site is never overwritten unless you tick **Replace existing site**.

## Databases
Available from the dashboard and inside each project's studio. The panel finds databases from each project's `.env` files (`DATABASE_URL`, `MONGODB_URI`, `MYSQL_*`, `DB_*`, `PG*`, `REDIS_URL`, SQLite paths) and from the database servers themselves (PostgreSQL via the `postgres` system user, MySQL via credentials found in projects, MongoDB and Redis on localhost), and links each database to its project.

- **Data** — paginated rows, search across all columns (MongoDB: text or a JSON filter; Redis: a key pattern), open long values, insert and delete rows (tables with a primary key), export to JSON, drop table.
- **Structure** — columns, types, primary keys, defaults.
- **Query console** — run SQL, MongoDB shell expressions or Redis commands directly. Write queries change live data.

## Domain email
**Domain Email Inbox** in the sidebar. Requires the mail server to be set up once on the panel host — see [Operations → Mail server](OPERATIONS.md#mail-server).

- **Mailboxes** — create `you@yourdomain.com` with a password and quota; edit, suspend or delete (stored mail is archived, not erased). The right-hand card shows the IMAP / POP3 / SMTP settings for Outlook, Apple Mail, phones and apps.
- **Webmail** — Inbox, Sent, Drafts, Junk, Trash; read HTML mail and attachments; compose, reply, attach files.
- **Domains & DNS** — the MX, SPF, DKIM, DMARC, A and PTR records each domain needs, checked live against public DNS; an optional catch-all address per domain.
- **Delivery log** — every delivery attempt (sent / deferred / bounced) with the reason.

## Administration
System admins see the super-admin console: users (create, suspend, reset password, revoke sessions, impersonate), organizations and plans, servers across all organizations, subscriptions, platform settings, audit logs and idempotency records.
