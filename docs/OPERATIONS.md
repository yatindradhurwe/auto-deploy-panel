# Operations

## Installation

```bash
# Prerequisites (Ubuntu)
apt install -y nginx git certbot python3-certbot-nginx
# Node.js 20+ and PM2
npm install -g pm2

git clone https://github.com/yatindradhurwe/auto-deploy-panel.git /var/www/auto-deploy-panel
cd /var/www/auto-deploy-panel
(cd backend && npm install)
(cd frontend && npm install && npm run build)

node backend/scripts/set-admin-password.js admin@example.com   # prompts for the password
PANEL_PUBLIC_IP=<this server's public IP> pm2 start backend/server.js --name auto-deploy-panel
pm2 save && pm2 startup
```

The panel must run as **root** on the host it manages: it creates sites under `/var/www`, writes nginx configs, runs certbot, manages PM2 apps and databases.

### nginx
```nginx
server {
    server_name panel.example.com;
    root /var/www/auto-deploy-panel/frontend/dist;
    index index.html;
    client_max_body_size 64m;

    location / { try_files $uri $uri/ /index.html; }

    location /api/ {
        proxy_pass http://127.0.0.1:4040;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600;
        proxy_buffering off;          # live progress streams (deploy, AI agent)
    }
}
```
Then `certbot --nginx -d panel.example.com`.

Uploads are sent in 8 MB chunks, so `client_max_body_size 64m` is enough for archives of any size (up to 2 GB).

### Updating the panel
```bash
cd /var/www/auto-deploy-panel
git pull
(cd backend && npm install)
(cd frontend && npm install && npm run build)
pm2 restart auto-deploy-panel
```

## Mail server

The domain email feature needs Postfix, Dovecot and OpenDKIM configured once on the panel host:

```bash
sudo MAIL_HOST=panel.example.com bash backend/scripts/setup-mail-server.sh
```

- `MAIL_HOST` must resolve to this server and already have a Let's Encrypt certificate in `/etc/letsencrypt/live/$MAIL_HOST` — mail clients connect to it (IMAP 993, POP3 995, SMTP 587 / 465).
- The script is idempotent. It configures Postfix virtual mailboxes (maps managed by the panel: `/etc/postfix/panel_*`), submission ports with SASL auth and sender-login checks, Dovecot (IMAP/POP3/LMTP, passwd-file `/etc/dovecot/panel-users` with bcrypt hashes, quotas), OpenDKIM signing, and a certbot renew hook. Mail is stored in `/var/vmail/<domain>/<user>` (Maildir, owned by the `vmail` user).
- Open ports 25, 465, 587, 993 (and optionally 143, 995) in the firewall.
- After adding a domain, publish the DNS records shown under **Domains & DNS** (MX, SPF, DKIM, DMARC, the mail host's A record) and set the server's **reverse DNS (PTR)** at your VPS provider — without them, other providers reject or spam-folder the mail.

## Connected servers

- Servers are reached over SSH with the saved password or key (`ssh2`, one pooled connection per server). Prefer a dedicated SSH key: generate one, add the public key to the server's `~/.ssh/authorized_keys`, and paste the private key when connecting.
- Commands run as the SSH user; most features (nginx, certbot, PM2 for root, `/var/www`) assume `root` or passwordless sudo.
- Discovery looks in `/var/www/*` and `/home/*/htdocs/*`, PM2 working directories and nginx sites. Deployments install to `/var/www/<app>`.
- A server shows **unreachable** when SSH fails; hover the badge for the reason (login rejected, timeout, refused).

## Security notes

- `/api/studio` (command execution, files, databases, mail, AI agent) is limited to **system admins**. Treat admin accounts like root access to every connected server.
- Server credentials, AI keys and the JWT secret live in `backend/data/` (git-ignored, files mode 600 where created by the panel). Server SSH passwords are stored unencrypted in `db.json` — protect the panel host and use SSH keys where possible.
- Credentials are never returned by the API; database connections are referenced by opaque ids.
- Scripts are executed from private temp files so secrets never appear in process lists; all user-supplied values that reach a shell are validated and single-quoted.
- The AI agent's commands are allowlisted and confined to the project folder, but builds and `npm install` run the project's own code.
- Set `GITHUB_WEBHOOK_SECRET` so push webhooks are verified.

## Backups

Back up:
- `backend/data/` — the whole panel state (users, servers, projects, settings, agent sessions).
- For email: `/var/vmail`, `/etc/opendkim/keys`, `/etc/dovecot/panel-users`, `/etc/postfix/panel_*`.
- Deployed apps keep their previous version as `/var/www/<app>.previous-<timestamp>` after a redeploy; remove old ones when no longer needed.

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel shows no data / 502 | `pm2 logs auto-deploy-panel --err`; is the backend listening on 127.0.0.1:4040? |
| Server shows **unreachable** | The tooltip reason; `ssh -p <port> <user>@<host>` from the panel host; firewall; changed password (edit the server). |
| Wrong server's data appears | The server menu selection; the browser must send `X-Server-Id` (hard-refresh after updating the panel). |
| Deploy fails at **Installing dependencies** / **Building** | Expand **Show details**; missing Node/PHP/Python versions are named in the error. |
| Deploy shows **HTTPS warning** | The domain's DNS A record must point to the server; redeploy after DNS updates. |
| App crashes after start | The deploy log includes the last PM2 log lines — usually a missing env variable or database connection. |
| MySQL database creation fails | MySQL root needs a password on that server — enter the MySQL admin login in the Database step. |
| Mail not received | **Domains & DNS** (MX must point to the mail host); **Delivery log**; `tail -f /var/log/mail.log`. |
| Mail sent but lands in spam | SPF, DKIM, DMARC and PTR records (all must be green in **Domains & DNS**). |
| AI agent: "model not available" | Change the model name in the agent's gear settings. |
| AI agent: key rejected / quota | Update the key; check billing at the provider. |
