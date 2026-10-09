const { Client } = require('ssh2')
const conn = new Client()

conn.on('ready', () => {
  const script = `
    echo "=== PM2 STATUS ==="
    pm2 status
    echo "=== NGINX CONFIG FOR AUTOMATE DEPLOYMENT ==="
    cat /etc/nginx/sites-enabled/*automate* 2>/dev/null || cat /etc/nginx/sites-available/*automate* 2>/dev/null || grep -rn "automate-deployment" /etc/nginx/
    echo "=== PM2 RECENT ERROR LOGS ==="
    tail -n 30 /root/.pm2/logs/auto-deploy-panel-error.log
  `
  conn.exec(script, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      process.exit(1)
    }
    stream.on('data', (d) => process.stdout.write(d.toString()))
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()))
    stream.on('close', () => {
      conn.end()
      process.exit(0)
    })
  })
}).connect({
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: process.env.VPS_SSH_PASSWORD
})
