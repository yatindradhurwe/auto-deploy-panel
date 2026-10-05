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
  const code = `
    import fs from 'fs';
    import path from 'path';
    import { discoverServerProjects } from './routes/studio.routes.js';
    const projs = discoverServerProjects();
    console.log(JSON.stringify(projs, null, 2));
  `
  const cmd = `cd /var/www/auto-deploy-panel/backend && node --input-type=module -e "${code.replace(/"/g, '\\"')}"`
  
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
