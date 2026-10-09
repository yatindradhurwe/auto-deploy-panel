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
    cd /var/www/auto-deploy-panel/backend
    TOKEN=$(node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:'admin-001', email:'admin@tipcrm.com', role:'admin'}, process.env.JWT_SECRET || 'autodeploy_secret_key_2026_prod'));")
    curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4040/api/studio/projects
  `
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => console.log('RAW RESPONSE:\n', d.toString()))
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
