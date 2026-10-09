import { Client } from 'ssh2'

const conn = new Client()
conn.on('ready', () => {
  conn.exec('ls -la /etc/nginx/sites-available/ ; ls -la /etc/nginx/sites-enabled/ ; cat /etc/nginx/sites-available/* 2>/dev/null', (err, stream) => {
    if (err) throw err
    let out = ''
    stream.on('data', d => out += d.toString())
    stream.stderr.on('data', d => out += d.toString())
    stream.on('close', () => {
      console.log('=== NGINX SITES AVAILABLE & ENABLED ===')
      console.log(out)
      conn.end()
    })
  })
}).connect({
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: process.env.VPS_SSH_PASSWORD
})
