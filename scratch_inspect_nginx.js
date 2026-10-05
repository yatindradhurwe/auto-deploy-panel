import { Client } from 'ssh2'

const conn = new Client()
conn.on('ready', () => {
  console.log('SSH Client Connected')
  conn.exec('grep -rn "server_name" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ ; ls -la /var/www/ ; pm2 jlist', (err, stream) => {
    if (err) throw err
    let out = ''
    stream.on('data', d => out += d.toString())
    stream.stderr.on('data', d => out += d.toString())
    stream.on('close', () => {
      console.log('--- OUTPUT FROM VPS ---')
      console.log(out)
      conn.end()
    })
  })
}).connect({
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: 'Yatindra@1223'
})
