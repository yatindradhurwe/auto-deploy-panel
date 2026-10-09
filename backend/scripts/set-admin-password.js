#!/usr/bin/env node
/**
 * Sets (or resets) a panel user's login password.
 * Usage: node backend/scripts/set-admin-password.js [email]
 * Defaults to the system admin account. The password is read from a hidden prompt, never from argv.
 */
import readline from 'readline'
import bcrypt from 'bcryptjs'
import { getUserByEmail, getUserById, updateUser } from '../services/db.service.js'

const email = (process.argv[2] || '').trim().toLowerCase()
const user = email ? getUserByEmail(email) : getUserById('admin-001')

if (!user) {
  console.error(`No user found for ${email || 'admin-001'}`)
  process.exit(1)
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (str) => {
      if (str.startsWith(question)) rl.output.write(question)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const password = await promptHidden(`New password for ${user.email}: `)
if (password.length < 10) {
  console.error('Password must be at least 10 characters.')
  process.exit(1)
}
const confirm = await promptHidden('Confirm password: ')
if (password !== confirm) {
  console.error('Passwords do not match.')
  process.exit(1)
}

updateUser(user.id, { passwordHash: bcrypt.hashSync(password, 10) })
console.log(`Password updated for ${user.email}.`)
