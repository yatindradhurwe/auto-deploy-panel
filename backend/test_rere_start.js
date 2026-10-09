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
    cd /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech
    echo "=== BUILDING RERE DESK PROJECT ==="
    npm run build
    
    echo "=== STARTING PM2 PROCESS FOR rere-desk ON PORT 3009 ==="
    pm2 start dist/server.cjs --name "rere-desk" --cwd "/home/kshana-rere-desk/htdocs/rere-desk.kshana.tech" || pm2 start "npm start" --name "rere-desk"
    pm2 save

    echo "=== TESTING LOCAL PORT 3009 ==="
    sleep 2
    curl -I http://127.0.0.1:3009/
    
    echo "=== TESTING PUBLIC NGINX PROXY https://rere-desk.kshana.tech/ ==="
    curl -I https://rere-desk.kshana.tech/
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
