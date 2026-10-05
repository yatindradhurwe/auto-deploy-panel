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
    const fs = require('fs');
    
    // 1. Update vite.config.ts to allow all hosts
    let vConf = fs.readFileSync('vite.config.ts', 'utf8');
    if (!vConf.includes('allowedHosts')) {
      vConf = vConf.replace('defineConfig({', 'defineConfig({\\n  server: { allowedHosts: true },');
      fs.writeFileSync('vite.config.ts', vConf, 'utf8');
      console.log('Updated vite.config.ts with allowedHosts: true');
    }

    // 2. Update server.ts to set trust proxy
    let sConf = fs.readFileSync('server.ts', 'utf8');
    if (!sConf.includes("trust proxy")) {
      sConf = sConf.replace('const app = express();', 'const app = express();\\napp.set("trust proxy", true);');
      fs.writeFileSync('server.ts', sConf, 'utf8');
      console.log('Updated server.ts with trust proxy setting');
    }
  `

  const cmd = `
    cd /home/kshana-rere-desk/htdocs/rere-desk.kshana.tech
    node -e "${code.replace(/"/g, '\\"')}"
    
    echo "=== REBUILDING RERE DESK ==="
    npm run build
    
    echo "=== RESTARTING PM2 PROCESS WITH NODE_ENV=production ==="
    pm2 delete rere-desk 2>/dev/null || true
    pm2 start dist/server.cjs --name "rere-desk" --cwd "/home/kshana-rere-desk/htdocs/rere-desk.kshana.tech" --env production
    pm2 save

    echo "=== VERIFYING LOCAL PORT 3009 ==="
    sleep 2
    curl -I http://127.0.0.1:3009/

    echo "=== VERIFYING PUBLIC HTTPS RESPONSE ==="
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
