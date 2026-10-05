const { Client } = require('ssh2')

const conn = new Client()

const config = {
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: 'Yatindra@1223',
  readyTimeout: 15000
}

console.log(`[SSH] Connecting to Live VPS (${config.host}:${config.port})...`)

conn.on('ready', () => {
  console.log('[SSH] Connection Established! Executing Live Deployment...')

  const updateScript = `
    export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:~/.nvm/versions/node/$(ls ~/.nvm/versions/node 2>/dev/null | tail -n 1)/bin

    PANEL_DIR=""
    if [ -d "/var/www/auto-deploy-panel" ]; then
      PANEL_DIR="/var/www/auto-deploy-panel"
    elif [ -d "/var/www/autodeploy-panel" ]; then
      PANEL_DIR="/var/www/autodeploy-panel"
    fi

    if [ -z "$PANEL_DIR" ]; then
      PANEL_DIR=$(find /var/www -maxdepth 3 -name "auto-deploy-panel" -type d 2>/dev/null | head -n 1)
    fi

    echo "Panel Directory: $PANEL_DIR"

    if [ -n "$PANEL_DIR" -a -d "$PANEL_DIR/.git" ]; then
      echo "[1/4] Pulling Latest Code from GitHub (main)..."
      cd $PANEL_DIR
      git fetch --all
      git reset --hard origin/main
      git pull origin main

      echo "[2/4] Building Frontend Assets..."
      if [ -d "$PANEL_DIR/frontend" ]; then
        cd $PANEL_DIR/frontend
        npm install --production=false
        npm run build
      fi

      echo "[3/4] Installing Backend Dependencies..."
      if [ -d "$PANEL_DIR/backend" ]; then
        cd $PANEL_DIR/backend
        npm install
      fi

      echo "[4/4] Starting & Reloading PM2 Services & Nginx..."
      cd $PANEL_DIR
      pm2 describe auto-deploy-panel >/dev/null 2>&1 || pm2 start backend/server.js --name auto-deploy-panel
      pm2 reload all || pm2 restart all || true
      pm2 save || true
      nginx -t && systemctl reload nginx || true

      echo "🎉 LIVE VPS DEPLOYMENT COMPLETED SUCCESSFULLY!"
    else
      echo "❌ Error: Could not locate auto-deploy-panel git repo."
    fi
  `

  conn.exec(updateScript, (err, stream) => {
    if (err) {
      console.error('Execution Error:', err)
      conn.end()
      process.exit(1)
    }

    stream.on('data', (data) => process.stdout.write(data.toString()))
    stream.stderr.on('data', (data) => process.stderr.write(data.toString()))
    stream.on('close', (code) => {
      console.log(`[SSH] Command closed with exit code ${code}`)
      conn.end()
      process.exit(code || 0)
    })
  })
})

conn.on('error', (err) => {
  console.error('[SSH ERROR]:', err.message)
  process.exit(1)
})

conn.connect(config)
