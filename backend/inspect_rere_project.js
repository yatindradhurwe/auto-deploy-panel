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
    echo "=== .env IN PROJECT ==="
    cat /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech/.env 2>/dev/null

    echo "=== package.json SCRIPTS ==="
    cat /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech/package.json 2>/dev/null

    echo "=== NGINX ERROR LOG (LAST 20 LINES) ==="
    tail -n 20 /home/kshana-rere-desk/logs/nginx/error.log 2>/dev/null || tail -n 20 /var/log/nginx/error.log 2>/dev/null

    echo "=== PM2 LIST ALL ==="
    pm2 list
  `
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => console.log(d.toString()))
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
