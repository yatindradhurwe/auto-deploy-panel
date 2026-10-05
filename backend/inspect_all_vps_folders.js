import { Client } from 'ssh2'

const conn = new Client()

const config = {
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: 'Yatindra@1223',
  readyTimeout: 30000
}

conn.on('ready', () => {
  const cmd = `
    echo "=== DIRECTORIES IN /var/www ==="
    ls -d /var/www/*/
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
