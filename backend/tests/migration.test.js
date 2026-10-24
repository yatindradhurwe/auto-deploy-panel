import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Run against a throwaway database, never the live data/db.json (services are imported dynamically below)
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodeploy-migration-test-'))
process.env.AUTODEPLOY_DB_PATH = path.join(TEST_DIR, 'db.json')

const { supabaseProjectUrl, migrateSupabaseStorage, inspectSupabaseStorage, publicBucketLocations, STORAGE_ROOT } = await import('../services/supabase-storage.service.js')
const { validateDeployConfig, STAGES } = await import('../services/deploy-pipeline.service.js')

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }
const rejects = async (fn, re) => { await assert.rejects(fn, (e) => re.test(e.message)) }

// --- a fake Supabase Storage API
const BASE = 'https://abcdefghij.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role-test-key.sig'
const BUCKETS = { avatars: { public: true, files: { 'u1/me.png': 'png', 'u1/deep/x.txt': 'x', 'top.txt': 'top' } }, private: { public: false, files: { 'doc.pdf': 'pdf', '../escape.txt': 'bad' } } }
const calls = []
globalThis.fetch = async (url, { method = 'GET', headers, body } = {}) => {
  calls.push({ url, method, headers })
  const json = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) })
  if (headers.apikey !== KEY) return json({ message: 'Invalid API key' }, 401)
  if (url === `${BASE}/storage/v1/bucket`) return json(Object.entries(BUCKETS).map(([id, b]) => ({ id, name: id, public: b.public })))
  const m = url.match(/\/storage\/v1\/object\/list\/([^/]+)$/)
  if (m && method === 'POST') {
    const { prefix, offset } = JSON.parse(body)
    if (offset) return json([])
    const names = new Map()
    for (const p of Object.keys(BUCKETS[decodeURIComponent(m[1])].files)) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const [first, ...more] = rest.split('/')
      names.set(first, more.length ? { name: first, id: null } : { name: first, id: `id-${p}`, metadata: { size: 10 } })
    }
    return json([...names.values()])
  }
  return json({ message: 'not found' }, 404)
}

// --- a fake host: curl writes each configured url's file from the fake buckets
const ROOT = path.join(TEST_DIR, 'root')
const local = (p) => path.join(ROOT, p)
const host = {
  files: new Map(),
  async writeFile(p, data) { this.files.set(p, String(data)) },
  async exec(script) {
    if (script.startsWith('command -v curl')) return { code: 0, stdout: 'ok\n', stderr: '' }
    const conf = script.match(/curl --config '([^']+)'/)
    if (conf) {
      const text = this.files.get(conf[1])
      assert.ok(text.includes(`header = "apikey: ${KEY}"`) && text.includes(`header = "Authorization: Bearer ${KEY}"`))
      const urls = [...text.matchAll(/^url = "(.*)"$/gm)].map(x => x[1])
      const outs = [...text.matchAll(/^output = "(.*)"$/gm)].map(x => x[1])
      urls.forEach((u, i) => {
        const [, bucket, obj] = u.match(/\/storage\/v1\/object\/([^/]+)\/(.+)$/)
        const file = local(outs[i])
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, BUCKETS[bucket].files[obj.split('/').map(decodeURIComponent).join('/')])
      })
      return { code: 0, stdout: '', stderr: '' }
    }
    const find = script.match(/^find '([^']+)' -type f/)
    if (find) {
      const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [e]) : []
      return { code: 0, stdout: `${walk(local(find[1])).length}\n`, stderr: '' }
    }
    if (script.startsWith('rm -f')) this.files.delete(script.match(/'([^']+)'/)[1])
    return { code: 0, stdout: '', stderr: '' }
  }
}

await test('project URL: API URL and dashboard link accepted, other hosts refused', async () => {
  assert.equal(supabaseProjectUrl('https://AbcdefghiJ.supabase.co/'), BASE)
  assert.equal(supabaseProjectUrl('abcdefghij.supabase.co'), BASE)
  assert.equal(supabaseProjectUrl('https://supabase.com/dashboard/project/abcdefghij/settings/api'), BASE)
  assert.throws(() => supabaseProjectUrl('http://169.254.169.254/latest'), /Supabase project URL/)
  assert.throws(() => supabaseProjectUrl('https://abcdefghij.supabase.co.evil.com'), /Supabase project URL/)
})

await test('inspect lists buckets with counts; a wrong or publishable key is refused', async () => {
  const r = await inspectSupabaseStorage({ url: BASE, key: KEY })
  assert.deepEqual(r.buckets.map(b => [b.name, b.public, b.files]), [['avatars', true, 3], ['private', false, 2]])
  await rejects(() => inspectSupabaseStorage({ url: BASE, key: 'eyJwrongwrongwrongwrongwrong' }), /rejected the key/)
  await rejects(() => inspectSupabaseStorage({ url: BASE, key: 'sb_publishable_abcdefghijklmnopqrstuvwxyz' }), /publishable key/)
})

await test('migration downloads every bucket, walks folders and skips unsafe paths', async () => {
  const r = await migrateSupabaseStorage(host, { url: BASE, key: KEY, appName: 'shop' })
  assert.equal(r.dir, `${STORAGE_ROOT}/shop`)
  assert.equal(fs.readFileSync(local(`${STORAGE_ROOT}/shop/avatars/u1/deep/x.txt`), 'utf8'), 'x')
  assert.equal(fs.readFileSync(local(`${STORAGE_ROOT}/shop/private/doc.pdf`), 'utf8'), 'pdf')
  assert.ok(!fs.existsSync(local(`${STORAGE_ROOT}/shop/escape.txt`)))
  assert.deepEqual(r.skipped, ['private/../escape.txt'])
  assert.deepEqual(r.buckets.map(b => [b.name, b.files, b.failed]), [['avatars', 3, 0], ['private', 1, 0]])
  assert.equal(host.files.size, 0, 'the curl config holding the key is removed')
})

await test('nginx serves only public buckets at Supabase paths', async () => {
  const conf = publicBucketLocations('/srv/s', [{ name: 'avatars', public: true }, { name: 'private', public: false }])
  assert.ok(conf.includes('location ^~ /storage/v1/object/public/avatars/ {') && conf.includes('alias /srv/s/avatars/;'))
  assert.ok(!conf.includes('private'))
})

await test('deploy config: migrate mode validates the source and storage', async () => {
  const base = { appName: 'shop', domain: 'shop.example.com', source: { type: 'github', gitUrl: 'https://github.com/a/b', branch: 'main' } }
  const cfg = validateDeployConfig({ ...base, database: { mode: 'migrate', sourceUrl: 'postgresql://u:p@db.x.supabase.co:5432/postgres', storage: { url: 'abcdefghij.supabase.co', key: KEY }, name: 'shop_db' } }, 'u1')
  assert.equal(cfg.database.engine, 'postgresql')
  assert.equal(cfg.database.includeAuth, true)
  assert.equal(cfg.database.name, 'shop_db')
  assert.deepEqual(cfg.database.storage, { url: BASE, key: KEY })
  assert.ok(STAGES.some(s => s.id === 'storage'))
  assert.throws(() => validateDeployConfig({ ...base, database: { mode: 'migrate', sourceUrl: 'mysql://u:p@h/db' } }, 'u1'), /connection string/)
  assert.throws(() => validateDeployConfig({ ...base, database: { mode: 'migrate', sourceUrl: 'postgres://u:p@h/db', storage: { url: BASE } } }, 'u1'), /service_role/)
})

fs.rmSync(TEST_DIR, { recursive: true, force: true })
console.log(`\n${passed} migration tests passed`)
