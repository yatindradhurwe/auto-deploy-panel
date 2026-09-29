const { Client } = require('ssh2')
const conn = new Client()

conn.on('ready', () => {
  conn.exec('tail -n 40 /root/.pm2/logs/auto-deploy-panel-error.log', (err, stream) => {
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
  password: 'Yatindra@1223'
})
