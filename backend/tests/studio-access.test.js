import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Throwaway database, never the live data/db.json (services are imported after this is set)
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodeploy-test-'))
process.env.AUTODEPLOY_DB_PATH = path.join(TEST_DIR, 'db.json')
process.on('exit', () => fs.rmSync(TEST_DIR, { recursive: true, force: true }))

const { requireStudioAccess } = await import('../middleware/studioAccess.middleware.js')

const customerServer = { id: 'srv-c', organizationId: 'org-c', ipAddress: '203.0.113.10' }

function run(route, { memberRole = 'OWNER', body = {}, server = customerServer } = {}) {
  const req = {
    path: route,
    body,
    query: {},
    user: { id: 'usr-c', role: 'user', portal: 'panel' },
    tenant: { organizationId: 'org-c', memberRole, server }
  }
  let status = 200
  let passed = false
  const res = { status(s) { status = s; return this }, json() { return this } }
  requireStudioAccess(req, res, () => { passed = true })
  return { passed, status, level: req.studioAccess?.level }
}

const ownerRoutes = [
  '/databases/uploads/abc123/chunk',
  '/databases/uploads/abc123/complete',
  '/supabase/projects',
  '/supabase/projects/create',
  '/supabase/projects/keys/rotate',
  '/mobile-app/get',
  '/mobile-app/github/build',
  '/mobile-app/server/download'
]

for (const route of ownerRoutes) {
  assert.deepStrictEqual(run(route), { passed: true, status: 200, level: 'owner' }, `owner should reach ${route}`)
  assert.strictEqual(run(route, { memberRole: 'MEMBER' }).status, 403, `members must not reach ${route}`)
  assert.strictEqual(run(route, { server: { id: 'srv-default', organizationId: 'org-default' } }).status, 403, `${route} must not run on the platform host`)
}
console.log('ok - org owners reach database import, Supabase stacks and the mobile app builder; members and the platform host do not')

assert.strictEqual(run('/projects/attach-database', { body: { projectPath: '/var/www/app' } }).passed, true)
assert.strictEqual(run('/projects/attach-database', { memberRole: 'MEMBER', body: { projectPath: '/var/www/app' } }).status, 403)
console.log('ok - attach-database needs manager access to the project')

for (const route of ['/autoupdate/list', '/autoupdate/config', '/autoupdate/trigger-now', '/ai/agent/settings', '/supabase/projects/anything-else']) {
  assert.strictEqual(run(route).status, 403, `${route} stays super-admin only`)
}
console.log('ok - auto-update, AI settings and unknown routes stay super-admin only')
