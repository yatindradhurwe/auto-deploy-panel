import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_FILE = path.join(__dirname, '../data/db.json')

// Read raw email stream from Postfix STDIN
let rawEmail = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  rawEmail += chunk
})

process.stdin.on('end', () => {
  try {
    const lines = rawEmail.split('\n')
    let from = 'unknown@external.com'
    let to = 'admin@litigation.yjtechnosoft.com'
    let subject = '(No Subject)'
    let bodyLines = []
    let isBody = false

    for (let line of lines) {
      if (!isBody) {
        if (line.trim() === '') {
          isBody = true
          continue
        }
        if (line.toLowerCase().startsWith('from:')) {
          const match = line.match(/<([^>]+)>/)
          from = match ? match[1] : line.split(':').slice(1).join(':').trim()
          from = from.replace(/["']/g, '').trim()
        } else if (line.toLowerCase().startsWith('to:')) {
          const match = line.match(/<([^>]+)>/)
          to = match ? match[1] : line.split(':').slice(1).join(':').trim()
          to = to.replace(/["']/g, '').trim()
        } else if (line.toLowerCase().startsWith('subject:')) {
          subject = line.substring(8).trim()
        }
      } else {
        bodyLines.push(line)
      }
    }

    const body = bodyLines.join('\n').trim() || '(Empty message body)'
    const now = new Date().toISOString()

    let db = { emailMessages: [] }
    if (fs.existsSync(DB_FILE)) {
      try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      } catch (e) {}
    }
    if (!db.emailMessages) db.emailMessages = []

    const newMsg = {
      id: `msg-inbound-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      mailbox: to.toLowerCase(),
      folder: 'inbox',
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      subject,
      body,
      timestamp: now,
      read: false
    }

    db.emailMessages.unshift(newMsg)
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8')
    console.log(`[INBOUND EMAIL STORED SUCCESSFULLY] From: ${from} -> To: ${to} | Subject: ${subject}`)
  } catch (err) {
    console.error('[RECEIVE MAIL ERROR]:', err)
  }
})
