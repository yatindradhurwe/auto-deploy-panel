import { Client } from 'ssh2'

const conn = new Client()

const config = {
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: 'Yatindra@1223',
  readyTimeout: 20000
}

console.log('[DEPLOY-LIVE] Connecting to VPS node 187.127.165.128 via SSH...')

conn.on('ready', () => {
  console.log('[DEPLOY-LIVE] SSH Connection established successfully ✓')
  
  const cmd = `cd /var/www/auto-deploy-panel && git pull origin main && npm run build:frontend && pm2 reload all`
  console.log(`[DEPLOY-LIVE] Executing command on server: ${cmd}`)

  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('[DEPLOY-LIVE ERROR]:', err)
      conn.end()
      process.exit(1)
    }

    stream.on('close', (code, signal) => {
      console.log(`[DEPLOY-LIVE] Command exited with code: ${code}`)
      conn.end()
      if (code === 0) {
        console.log('[DEPLOY-LIVE SUCCESS] Live server updated successfully!')
      } else {
        console.error('[DEPLOY-LIVE FAILED] Server update exited with non-zero code.')
      }
    }).on('data', (data) => {
      process.stdout.write('[SSH STDOUT]: ' + data.toString())
    }).stderr.on('data', (data) => {
      process.stderr.write('[SSH STDERR]: ' + data.toString())
    })
  })
})

conn.on('error', (err) => {
  console.error('[DEPLOY-LIVE SSH CONNECTION ERROR]:', err.message)
  process.exit(1)
})

conn.connect(config)
