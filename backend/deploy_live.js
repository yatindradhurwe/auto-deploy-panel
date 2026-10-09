import { Client } from 'ssh2'

const conn = new Client()

const config = {
  host: '187.127.165.128',
  port: 22,
  username: 'root',
  password: process.env.VPS_SSH_PASSWORD,
  readyTimeout: 30000
}

console.log('[DEPLOY-LIVE] Connecting to VPS node 187.127.165.128 via SSH...')

conn.on('ready', () => {
  console.log('[DEPLOY-LIVE] SSH Connection established successfully ✓')
  
  const cmd = `cd /var/www/auto-deploy-panel && git pull origin main && npm run build:frontend && pm2 reload all`
  console.log(`[DEPLOY-LIVE] Executing command on server:\n${cmd}\n`)

  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('[DEPLOY-LIVE ERROR]:', err)
      conn.end()
      process.exit(1)
    }

    stream.on('close', (code, signal) => {
      console.log(`\n[DEPLOY-LIVE] Command finished with exit code: ${code}`)
      conn.end()
      if (code === 0) {
        console.log('\n==================================================')
        console.log('🎉 LIVE SERVER UPDATE COMPLETED SUCCESSFULLY!')
        console.log('==================================================')
      } else {
        console.error('[DEPLOY-LIVE FAILED] Server update exited with non-zero code.')
      }
    }).on('data', (data) => {
      process.stdout.write(data.toString())
    }).stderr.on('data', (data) => {
      process.stderr.write(data.toString())
    })
  })
})

conn.on('error', (err) => {
  console.error('[DEPLOY-LIVE SSH CONNECTION ERROR]:', err.message)
  process.exit(1)
})

conn.connect(config)
