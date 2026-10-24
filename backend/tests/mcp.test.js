import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Run against a throwaway database, never the live data/db.json (services are imported dynamically below)
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodeploy-mcp-test-'))
process.env.AUTODEPLOY_DB_PATH = path.join(TEST_DIR, 'db.json')

const { readDb, writeDb } = await import('../services/db.service.js')
const { createToken, listTokens, revokeToken, authenticateMcpToken, handleRpc } = await import('../services/mcp.service.js')

const PROJECT = path.join(TEST_DIR, 'www', 'site')
fs.mkdirSync(PROJECT, { recursive: true })
fs.writeFileSync(path.join(PROJECT, 'index.html'), '<h1>Hello</h1>\n')

const db = readDb()
db.users = { ...(db.users || {}), 'u-super': { id: 'u-super', email: 'super@test.local', fullName: 'Super', platformRole: 'superadmin' }, 'u-admin': { id: 'u-admin', email: 'admin@test.local', fullName: 'Admin' } }
db.organizations = { ...(db.organizations || {}), 'org-default': { id: 'org-default', name: 'Platform' }, 'org-a': { id: 'org-a', name: 'A' } }
db.organizationMembers = [...(db.organizationMembers || []), { organizationId: 'org-a', userId: 'u-admin', role: 'OWNER' }]
writeDb(db)

const superReq = { user: { id: 'u-super', email: 'super@test.local', role: 'superadmin', portal: 'console' }, tenant: { organizationId: 'org-default', server: null, memberRole: 'OWNER' }, headers: {} }
const orgReq = { user: { id: 'u-admin', email: 'admin@test.local', role: 'admin', portal: 'panel' }, tenant: { organizationId: 'org-a', server: null, memberRole: 'OWNER' }, headers: {} }

let id = 0
const rpc = async (ctx, method, params) => handleRpc(ctx, { jsonrpc: '2.0', id: ++id, method, params })
const call = async (ctx, name, args = {}) => (await rpc(ctx, 'tools/call', { name, arguments: args })).result

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

try {
  await test('organization users cannot create tokens for the platform host', async () => {
    await assert.rejects(createToken(orgReq, { projectPath: PROJECT }), (e) => e.status === 403)
  })

  const { secret: editSecret, token: editToken } = await createToken(superReq, { projectPath: PROJECT, name: 'Claude Code', access: 'edit' })
  const { secret: readSecret } = await createToken(superReq, { projectPath: PROJECT, access: 'read', expiresInDays: 7 })

  await test('only the hash is stored and tokens are listed without secrets', async () => {
    const stored = readDb().mcpTokens.find((t) => t.id === editToken.id)
    assert.ok(stored.tokenHash && !JSON.stringify(stored).includes(editSecret))
    const listed = listTokens(superReq, PROJECT)
    assert.strictEqual(listed.length, 2)
    assert.ok(!JSON.stringify(listed).includes(editSecret))
  })

  const edit = authenticateMcpToken(editSecret)
  const read = authenticateMcpToken(readSecret)

  await test('initialize and tools/list follow the token access', async () => {
    const init = await rpc(edit, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    assert.strictEqual(init.result.protocolVersion, '2025-06-18')
    assert.ok(init.result.capabilities.tools)
    assert.strictEqual(await handleRpc(edit, { jsonrpc: '2.0', method: 'notifications/initialized' }), null)
    const editTools = (await rpc(edit, 'tools/list')).result.tools.map((t) => t.name)
    const readTools = (await rpc(read, 'tools/list')).result.tools.map((t) => t.name)
    assert.ok(editTools.includes('str_replace') && !editTools.includes('restart_app'))
    assert.deepStrictEqual(readTools, ['get_project_info', 'view', 'run_command', 'get_app_logs'])
  })

  await test('view, edit, list and undo changes', async () => {
    assert.match((await call(edit, 'view', { path: 'index.html' })).content[0].text, /Hello/)
    const r = await call(edit, 'str_replace', { path: 'index.html', old_str: 'Hello', new_str: 'Hi' })
    assert.strictEqual(r.isError, false, r.content[0].text)
    await call(edit, 'create_file', { path: 'src/new.js', content: 'export default 1\n' })
    assert.match((await call(edit, 'list_changes')).content[0].text, /modified index\.html[\s\S]*added\s+src\/new\.js/)
    await call(edit, 'undo_changes')
    assert.strictEqual(fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8'), '<h1>Hello</h1>\n')
    assert.ok(!fs.existsSync(path.join(PROJECT, 'src/new.js')))
  })

  await test('paths and commands stay inside the project and the allowlist', async () => {
    assert.strictEqual((await call(edit, 'view', { path: '../../../etc/passwd' })).isError, true)
    assert.strictEqual((await call(edit, 'run_command', { command: 'cat /etc/passwd' })).isError, true)
    assert.strictEqual((await call(edit, 'run_command', { command: 'ls | sh' })).isError, true)
    assert.match((await call(read, 'run_command', { command: 'ls' })).content[0].text, /index\.html/)
    assert.match((await call(read, 'run_command', { command: 'npm install' })).content[0].text, /read-only token/)
    assert.match((await call(read, 'create_file', { path: 'x.txt', content: 'x' })).content[0].text, /needs a token with edit access/)
    assert.match((await call(edit, 'restart_app')).content[0].text, /full access/)
  })

  await test('signing the user out everywhere, expiry and revoking stop the token', async () => {
    const d = readDb()
    d.users['u-super'].tokenVersion = 1
    writeDb(d)
    assert.throws(() => authenticateMcpToken(editSecret), /signed out/)
    d.users['u-super'].tokenVersion = 0
    d.mcpTokens.find((t) => t.access === 'read').expiresAt = new Date(Date.now() - 1000).toISOString()
    writeDb(d)
    assert.throws(() => authenticateMcpToken(readSecret), /expired/)
    revokeToken(superReq, editToken.id)
    assert.throws(() => authenticateMcpToken(editSecret), /not valid/)
    assert.throws(() => authenticateMcpToken('adpmcp_wrong'), /not valid/)
  })

  console.log(`\n${passed} MCP tests passed`)
} finally {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
}
