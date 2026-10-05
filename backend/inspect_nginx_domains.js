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
  const cmd = `grep -rn "server_name" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null`
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => console.log('NGINX DOMAINS:\n', d.toString()))
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
