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
  const cmd = `cat /etc/nginx/sites-enabled/rere-desk.kshana.tech.conf 2>/dev/null || cat /etc/nginx/sites-available/rere-desk.kshana.tech.conf 2>/dev/null`
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => console.log('NGINX CONFIG:\n', d.toString()))
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
