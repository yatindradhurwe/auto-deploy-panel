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
  const cmd = `curl -s http://127.0.0.1:4040/api/studio/projects`
  
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error(err)
      conn.end()
      return
    }
    stream.on('close', () => conn.end())
    stream.on('data', d => {
      try {
        const json = JSON.parse(d.toString())
        console.log('Total returned projects:', json.projects ? json.projects.length : 0)
        if (json.projects) {
          json.projects.forEach(p => console.log(' ->', p.name, '|', p.path, '|', p.domain))
        }
      } catch (e) {
        console.log(d.toString())
      }
    })
    stream.stderr.on('data', d => process.stderr.write(d.toString()))
  })
})

conn.connect(config)
