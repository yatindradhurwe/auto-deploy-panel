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
    echo "=== PM2 LOGS FOR rere-desk ==="
    pm2 logs rere-desk --lines 30 --nostream

    echo "=== PUBLIC CURL RESPONSE BODY FOR https://rere-desk.kshana.tech/ ==="
    curl -s -v https://rere-desk.kshana.tech/
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
