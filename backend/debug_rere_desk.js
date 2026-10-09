import { Client } from 'ssh2'

const conn = new Client()

const config = {
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: process.env.VPS_SSH_PASSWORD,
  readyTimeout: 30000
}

conn.on('ready', () => {
  const cmd = `
    echo "=== NGINX CONFIG FOR rere-desk.kshana.tech ==="
    cat /etc/nginx/sites-enabled/*rere-desk* 2>/dev/null || cat /etc/nginx/sites-available/*rere-desk* 2>/dev/null
    
    echo "=== PM2 PROCESSES LIST ==="
    pm2 list

    echo "=== LISTENING PORTS ==="
    ss -tulpn | grep LISTEN || netstat -tulpn | grep LISTEN

    echo "=== PROJECT FILES IN /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech ==="
    ls -la /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech 2>/dev/null || ls -la /var/www/*rere* 2>/dev/null
  `
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => process.stdout.write(d.toString()))
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
