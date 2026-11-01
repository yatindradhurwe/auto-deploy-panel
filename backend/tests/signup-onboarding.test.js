import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import express from 'express'

// Run against a throwaway database, never the live data/db.json. Static imports would load
// db.service before this line runs, so the services are imported dynamically below.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodeploy-test-'))
process.env.AUTODEPLOY_DB_PATH = path.join(TEST_DIR, 'db.json')
process.env.AUTODEPLOY_INTEGRATIONS_PATH = path.join(TEST_DIR, 'integrations.json')
process.env.AUTODEPLOY_DNS_PROVIDERS_PATH = path.join(TEST_DIR, 'dns-providers.json')
process.on('exit', () => fs.rmSync(TEST_DIR, { recursive: true, force: true }))

const { readDb, writeDb } = await import('../services/db.service.js')
const { default: authRoutes } = await import('../routes/auth.routes.js')

const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s))
})
const base = `http://127.0.0.1:${server.address().port}/api/auth`

async function post(route, body, token) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

const orgsOwnedBy = (userId) => Object.values(readDb().organizations || {}).filter((o) => o.ownerId === userId)

async function signup(email, orgName) {
  const res = await post('/signup', { fullName: 'Test User', email, password: 'correct-horse-1', orgName })
  assert.strictEqual(res.status, 200, JSON.stringify(res.body))
  return res.body
}

try {
  // The signup + onboarding flow the register page runs must leave exactly one organization
  const first = await signup('first@example.com', 'Acme Cloud')
  const onboarded = await post('/onboarding', { orgName: 'Acme Cloud', planId: 'FREE' }, first.token)
  assert.strictEqual(onboarded.status, 200, JSON.stringify(onboarded.body))
  assert.strictEqual(orgsOwnedBy(first.user.id).length, 1, 'onboarding must not create a second organization')
  assert.strictEqual(onboarded.body.organization.id, first.user.organizationId)
  assert.strictEqual(readDb().users[first.user.id].organizationId, first.user.organizationId)

  // The agent token is stored on the signup organization, where /api/agent/register looks for it
  const stored = readDb().organizations[first.user.organizationId]
  assert.deepStrictEqual(stored.agentTokens, [onboarded.body.agentToken])

  // Repeating the step stays idempotent for the organization
  await post('/onboarding', { orgName: 'Acme Cloud', planId: 'FREE' }, first.token)
  assert.strictEqual(orgsOwnedBy(first.user.id).length, 1, 'repeated onboarding must not create organizations')

  // Paid plans are bought through billing checkout, not by naming one here
  const second = await signup('second@example.com', 'Beta Cloud')
  await post('/onboarding', { orgName: 'Beta Cloud', planId: 'PROFESSIONAL' }, second.token)
  const db = readDb()
  assert.strictEqual(db.organizations[second.user.organizationId].planId, 'FREE')
  assert.strictEqual(db.subscriptions[second.user.organizationId].planId, 'FREE')

  // A user who has no organization (e.g. an admin created without one) still gets one, on the free plan
  const third = await signup('third@example.com', 'Gamma Cloud')
  const noOrg = readDb()
  delete noOrg.organizations[third.user.organizationId]
  noOrg.users[third.user.id].organizationId = null
  writeDb(noOrg)
  const created = await post('/onboarding', { orgName: 'Gamma Cloud', planId: 'PROFESSIONAL' }, third.token)
  assert.strictEqual(created.status, 200, JSON.stringify(created.body))
  assert.strictEqual(orgsOwnedBy(third.user.id).length, 1)
  assert.strictEqual(created.body.organization.planId, 'FREE')
  assert.strictEqual(readDb().users[third.user.id].organizationId, created.body.organization.id)

  console.log('signup-onboarding tests passed')
} finally {
  server.close()
}
process.exit(0)
