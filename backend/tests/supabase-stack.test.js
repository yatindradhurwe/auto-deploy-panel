import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

// Run against a throwaway database, never the live data/db.json (services are imported dynamically below)
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autodeploy-supabase-test-'))
process.env.AUTODEPLOY_DB_PATH = path.join(TEST_DIR, 'db.json')

const stack = await import('../services/supabase-stack.service.js')
const { validateDeployConfig, STAGES } = await import('../services/deploy-pipeline.service.js')
const { listVercelProjects, vercelProjectDetails, supabaseRefFromEnv } = await import('../services/vercel.service.js')
const { listSupabaseProjects, supabaseProjectDetails, poolerTemplate } = await import('../services/supabase-cloud.service.js')

let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }
const rejects = async (fn, re) => { await assert.rejects(fn, (e) => re.test(e.message)) }
const SECRET = 'a'.repeat(40)
const REF = 'abcdefghijklmnop'

// ------------------------------------------------------------------ keys
await test('signJwt/verifyJwt round trip; wrong secret and tampering rejected', () => {
  const t = stack.signJwt({ role: 'anon', ref: REF }, SECRET)
  assert.deepStrictEqual(stack.verifyJwt(t, SECRET), { role: 'anon', ref: REF })
  assert.strictEqual(stack.verifyJwt(t, 'b'.repeat(40)), null)
  const [h, , s] = t.split('.')
  assert.strictEqual(stack.verifyJwt(`${h}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.${s}`, SECRET), null)
})

await test('stackKeys keeps the source keys when they verify with the JWT secret, else mints new ones', () => {
  const source = stack.mintKeys(SECRET, REF)
  assert.deepStrictEqual(stack.stackKeys({ jwtSecret: SECRET, sourceKeys: source, ref: REF }), { keys: source, reused: true })
  const other = stack.stackKeys({ jwtSecret: 'c'.repeat(40), sourceKeys: source, ref: REF })
  assert.strictEqual(other.reused, false)
  assert.strictEqual(stack.verifyJwt(other.keys.anon, 'c'.repeat(40)).role, 'anon')
  assert.strictEqual(stack.verifyJwt(other.keys.service_role, 'c'.repeat(40)).role, 'service_role')
  assert.strictEqual(stack.verifyJwt(other.keys.anon, 'c'.repeat(40)).ref, REF)
})

// ------------------------------------------------------------------ auth settings
await test('normalizeAuthConfig keeps what GoTrue uses and drops providers without credentials', () => {
  const a = stack.normalizeAuthConfig({
    site_url: 'https://shop.example.com', uri_allow_list: 'https://a.example.com/**, https://b.example.com', disable_signup: true, mailer_autoconfirm: false,
    jwt_exp: 7200, password_min_length: 8, smtp_host: 'smtp.example.com', smtp_port: '465', smtp_user: 'u', smtp_pass: 'p\nx', smtp_admin_email: 'no-reply@example.com',
    external_google_enabled: true, external_google_client_id: 'gid', external_google_secret: 'gsecret',
    external_github_enabled: true, external_github_client_id: '', external_github_secret: 'x',
    external_azure_enabled: false, external_azure_client_id: 'a', external_azure_secret: 'b', some_unknown_key: 'dropped'
  })
  assert.strictEqual(a.siteUrl, 'https://shop.example.com')
  assert.deepStrictEqual(a.uriAllowList, ['https://a.example.com/**', 'https://b.example.com'])
  assert.strictEqual(a.disableSignup, true)
  assert.strictEqual(a.jwtExp, 7200)
  assert.strictEqual(a.smtp.port, 465)
  assert.strictEqual(a.smtp.pass, 'px') // newlines cannot reach an env file
  assert.deepStrictEqual(Object.keys(a.providers), ['google'])
  assert.strictEqual(a.some_unknown_key, undefined)
})

await test('gotrueEnv: auto-confirms without SMTP, moves a vercel.app site URL to the new domain, sets provider callbacks', () => {
  const env = Object.fromEntries(stack.gotrueEnv({
    port: 54100, publicUrl: 'https://app.example.com', dbUrl: 'postgres://u:p@127.0.0.1:5432/db?search_path=auth', jwtSecret: SECRET, migrationsPath: '/m',
    auth: stack.normalizeAuthConfig({ site_url: 'https://my-app.vercel.app', external_google_enabled: true, external_google_client_id: 'gid', external_google_secret: 'gs' })
  }))
  assert.strictEqual(env.GOTRUE_MAILER_AUTOCONFIRM, 'true')
  assert.strictEqual(env.GOTRUE_SITE_URL, 'https://app.example.com')
  assert.ok(env.GOTRUE_URI_ALLOW_LIST.includes('https://app.example.com/**'))
  assert.strictEqual(env.GOTRUE_API_HOST, '127.0.0.1')
  assert.strictEqual(env.GOTRUE_JWT_SECRET, SECRET)
  assert.strictEqual(env.GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI, 'https://app.example.com/auth/v1/callback')
  assert.strictEqual(env.GOTRUE_JWT_ADMIN_ROLES, 'service_role')
  const withSmtp = Object.fromEntries(stack.gotrueEnv({ port: 1, publicUrl: 'https://x.example.com', dbUrl: 'd', jwtSecret: SECRET, migrationsPath: '/m', auth: stack.normalizeAuthConfig({ smtp_host: 'smtp.x', site_url: 'https://www.x.example.com' }) }))
  assert.strictEqual(withSmtp.GOTRUE_MAILER_AUTOCONFIRM, 'false')
  assert.strictEqual(withSmtp.GOTRUE_SITE_URL, 'https://www.x.example.com')
})

// ------------------------------------------------------------------ the app's environment
await test('supabaseEnvLayer repoints URLs, keys, JWT secret and Supabase database URLs; leaves other values alone', () => {
  const keys = stack.mintKeys(SECRET, REF)
  const out = Object.fromEntries(stack.supabaseEnvLayer([
    ['VITE_SUPABASE_URL', `https://${REF}.supabase.co`],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', '"old-anon"'],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_x'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'old-service'],
    ['SUPABASE_SECRET_KEY', 'sb_secret_x'],
    ['SUPABASE_JWT_SECRET', 'old'],
    ['DIRECT_URL', `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`],
    ['POSTGRES_PRISMA_URL', 'postgres://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true'],
    ['IMAGE_BASE', `https://${REF}.supabase.co/storage/v1/object/public/img`],
    ['STRIPE_SECRET_KEY', 'sk_live_keep'],
    ['OTHER_DB', 'postgresql://u:p@other-host.example.com/db']
  ], { ref: REF, url: 'https://app.example.com', keys, jwtSecret: SECRET, dbUrl: 'postgresql://app:pw@127.0.0.1:5432/app' }))
  assert.strictEqual(out.VITE_SUPABASE_URL, 'https://app.example.com')
  assert.strictEqual(out.NEXT_PUBLIC_SUPABASE_ANON_KEY, keys.anon)
  assert.strictEqual(out.VITE_SUPABASE_PUBLISHABLE_KEY, keys.anon)
  assert.strictEqual(out.SUPABASE_SERVICE_ROLE_KEY, keys.service_role)
  assert.strictEqual(out.SUPABASE_SECRET_KEY, keys.service_role)
  assert.strictEqual(out.SUPABASE_JWT_SECRET, SECRET)
  assert.strictEqual(out.DIRECT_URL, 'postgresql://app:pw@127.0.0.1:5432/app')
  assert.strictEqual(out.POSTGRES_PRISMA_URL, 'postgresql://app:pw@127.0.0.1:5432/app')
  assert.strictEqual(out.IMAGE_BASE, 'https://app.example.com/storage/v1/object/public/img')
  assert.strictEqual(out.SUPABASE_URL, 'https://app.example.com')
  assert.strictEqual(out.STRIPE_SECRET_KEY, undefined)
  assert.strictEqual(out.OTHER_DB, undefined)
})

await test('noVerifyFromConfigToml finds functions deployed with verify_jwt = false', () => {
  const toml = `[api]\nport = 54321\n\n[functions.webhook]\nverify_jwt = false\n\n[functions.secure]\nverify_jwt = true\n\n[functions."stripe-hook"]\nimport_map = "./x.json"\nverify_jwt = false\n`
  assert.deepStrictEqual(stack.noVerifyFromConfigToml(toml), ['webhook', 'stripe-hook'])
  assert.deepStrictEqual(stack.noVerifyFromConfigToml(''), [])
})

await test('nginx: Supabase paths on the domain, gateway only on 127.0.0.1, functions optional', () => {
  const ports = { auth: 54100, rest: 54101, storage: 54102, functions: 54103, gateway: 54104 }
  const loc = stack.stackLocations(ports)
  for (const [p, port] of [['/auth/v1/', 54100], ['/rest/v1/', 54101], ['/storage/v1/', 54102], ['/functions/v1/', 54103]]) assert.ok(loc.includes(`location ${p} {\n        proxy_pass http://127.0.0.1:${port}/;`), p)
  assert.ok(!stack.stackLocations(ports, { functions: false }).includes('/functions/v1/'))
  const gw = stack.gatewayServer(ports)
  assert.ok(gw.includes('listen 127.0.0.1:54104;'))
  assert.ok(!/listen 80|listen \[::\]/.test(gw))
})

await test('removeStackScript and rewriteBuildScript quote their paths and ignore invalid app names', () => {
  assert.strictEqual(stack.removeStackScript('../etc'), 'true')
  assert.ok(stack.removeStackScript('my-app').includes("'/opt/autodeploy-supabase/apps/my-app'"))
  assert.ok(stack.rewriteBuildScript('my-app', "/var/www/it's").includes("'/var/www/it'\\''s'"))
})

// ------------------------------------------------------------------ build rewrite (runs the real script)
await test('rewrite-build.mjs rewrites built files only, swaps keys of the old project, drops stale .gz', () => {
  const dir = fs.mkdtempSync(path.join(TEST_DIR, 'proj-'))
  const newKeys = stack.mintKeys(SECRET, REF)
  const oldAnon = stack.signJwt({ iss: 'supabase', ref: REF, role: 'anon' }, 'old-secret-old-secret-old-secret-old')
  const otherProject = stack.signJwt({ iss: 'supabase', ref: 'zzzzzzzzzzzzzzzz', role: 'anon' }, 'x'.repeat(40))
  fs.mkdirSync(path.join(dir, 'dist/assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'dist/node_modules'), { recursive: true })
  const bundle = `a="https://${REF}.supabase.co";b="${oldAnon}";c="${otherProject}";d="wss://${REF}.supabase.co/realtime/v1"`
  fs.writeFileSync(path.join(dir, 'dist/assets/app.js'), bundle)
  fs.writeFileSync(path.join(dir, 'dist/assets/app.js.gz'), 'stale')
  fs.writeFileSync(path.join(dir, 'src/client.ts'), bundle)
  fs.writeFileSync(path.join(dir, 'dist/node_modules/x.js'), bundle)
  const stackJson = path.join(TEST_DIR, 'stack.json')
  fs.writeFileSync(stackJson, JSON.stringify({ ref: REF, url: 'https://app.example.com', keys: newKeys, keysChanged: true }))
  const out = execFileSync(process.execPath, [path.resolve('supabase-runtime/rewrite-build.mjs'), stackJson, dir]).toString()
  assert.match(out, /Pointed 1 built file/)
  const built = fs.readFileSync(path.join(dir, 'dist/assets/app.js'), 'utf8')
  assert.strictEqual(built, `a="https://app.example.com";b="${newKeys.anon}";c="${otherProject}";d="wss://app.example.com/realtime/v1"`)
  assert.ok(!fs.existsSync(path.join(dir, 'dist/assets/app.js.gz')))
  assert.strictEqual(fs.readFileSync(path.join(dir, 'src/client.ts'), 'utf8'), bundle) // sources untouched
  assert.strictEqual(fs.readFileSync(path.join(dir, 'dist/node_modules/x.js'), 'utf8'), bundle)
  // Same JWT secret as the source: keys stay, only the URL moves
  fs.writeFileSync(path.join(dir, 'dist/assets/app.js'), bundle)
  fs.writeFileSync(stackJson, JSON.stringify({ ref: REF, url: 'https://app.example.com', keys: newKeys, keysChanged: false }))
  execFileSync(process.execPath, [path.resolve('supabase-runtime/rewrite-build.mjs'), stackJson, dir])
  assert.ok(fs.readFileSync(path.join(dir, 'dist/assets/app.js'), 'utf8').includes(oldAnon))
})

// ------------------------------------------------------------------ deploy payload
await test('validateDeployConfig: Supabase stack options (ref from the pooler login, secret, keys, auth, function secrets)', () => {
  const keys = stack.mintKeys(SECRET, REF)
  const cfg = validateDeployConfig({
    appName: 'shop', domain: 'shop.example.com', source: { type: 'git', gitUrl: 'https://github.com/a/b.git', branch: 'main' },
    database: {
      mode: 'migrate', sourceUrl: `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
      supabase: { enabled: true, jwtSecret: SECRET, keys, auth: { disable_signup: true, junk: 1 }, functionSecrets: 'OPENAI_KEY=sk-1\n# note\nQUOTED="a b"', noVerifyJwt: ['webhook', 'bad name!'] }
    }
  }, 'user-1')
  const sb = cfg.database.supabase
  assert.strictEqual(sb.ref, REF)
  assert.strictEqual(sb.jwtSecret, SECRET)
  assert.deepStrictEqual(sb.sourceKeys, keys)
  assert.strictEqual(sb.auth.disableSignup, true)
  assert.deepStrictEqual(sb.functionSecrets, [['OPENAI_KEY', 'sk-1'], ['QUOTED', 'a b']])
  assert.deepStrictEqual(sb.noVerifyJwt, ['webhook'])
  assert.ok(STAGES.some(s => s.id === 'supabase'))
  const plain = validateDeployConfig({ appName: 'shop', domain: 'shop.example.com', source: { type: 'git', gitUrl: 'https://github.com/a/b.git' }, database: { mode: 'migrate', sourceUrl: 'postgresql://u:p@db.example.com/x' } }, 'user-1')
  assert.strictEqual(plain.database.supabase, undefined)
})

await test('validateDeployConfig rejects a short JWT secret', async () => {
  await rejects(async () => validateDeployConfig({ appName: 'shop', domain: 'shop.example.com', source: { type: 'git', gitUrl: 'https://github.com/a/b.git' }, database: { mode: 'migrate', sourceUrl: 'postgresql://u:p@db.example.com/x', supabase: { enabled: true, jwtSecret: 'short' } } }, 'u'), /32 or more characters/)
})

// ------------------------------------------------------------------ Vercel API (fake)
const realFetch = globalThis.fetch
const fakeApi = (routes) => {
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers })
    const u = new URL(url)
    const hit = routes.find(([re]) => re.test(`${u.pathname}${u.search}`))
    const [status, body] = hit ? hit[1](u) : [404, { error: { message: 'not found' } }]
    return { ok: status < 400, status, text: async () => JSON.stringify(body) }
  }
  return calls
}

await test('Vercel: lists personal and team projects with their repository', async () => {
  const calls = fakeApi([
    [/^\/v2\/teams/, () => [200, { teams: [{ id: 'team_1', name: 'Acme' }] }]],
    [/^\/v10\/projects\?limit=100$/, () => [200, { projects: [{ id: 'prj_a', name: 'site', framework: 'vite', updatedAt: 1, link: { type: 'github', org: 'me', repo: 'site', productionBranch: 'main' } }] }]],
    [/^\/v10\/projects\?limit=100&teamId=team_1$/, () => [200, { projects: [{ id: 'prj_b', name: 'shop', framework: 'nextjs', updatedAt: 2, link: { type: 'gitlab', projectNamespace: 'acme', projectName: 'shop', repo: 'shop', productionBranch: 'prod' } }] }]]
  ])
  const projects = await listVercelProjects('vercel_token_1234567890')
  assert.deepStrictEqual(projects.map(p => [p.name, p.team, p.repo, p.branch]), [['shop', 'Acme', 'https://gitlab.com/acme/shop.git', 'prod'], ['site', 'Personal', 'https://github.com/me/site.git', 'main']])
  assert.ok(calls.every(c => c.headers.Authorization === 'Bearer vercel_token_1234567890'))
})

await test('Vercel: project details → production env (sensitive ones flagged), build settings, custom domains, Supabase ref', async () => {
  fakeApi([
    [/^\/v9\/projects\/prj_b\?teamId=team_1$/, () => [200, { id: 'prj_b', name: 'shop', framework: 'vite', rootDirectory: 'web', buildCommand: 'npm run build && node x.js', outputDirectory: 'dist', link: { type: 'github', org: 'acme', repo: 'shop', productionBranch: 'main' } }]],
    [/^\/v10\/projects\/prj_b\/env\?teamId=team_1&decrypt=true$/, () => [200, { envs: [
      { key: 'VITE_SUPABASE_URL', value: `https://${REF}.supabase.co`, target: ['production', 'preview'], type: 'plain' },
      { key: 'VITE_SUPABASE_ANON_KEY', value: 'eyJ.x.y', target: ['production'], type: 'encrypted', decrypted: true },
      { key: 'STRIPE_SECRET', value: '', target: ['production'], type: 'sensitive' },
      { key: 'MULTI', value: 'line1\nline2 "q"', target: 'production', type: 'encrypted', decrypted: true },
      { key: 'PREVIEW_ONLY', value: 'x', target: ['preview'], type: 'plain' },
      { key: 'VERCEL_URL', value: 'x', target: ['production'], type: 'system' }
    ] }]],
    [/^\/v9\/projects\/prj_b\/domains/, () => [200, { domains: [{ name: 'shop.vercel.app' }, { name: 'shop.acme.com' }, { name: 'www.shop.acme.com', redirect: 'shop.acme.com' }] }]]
  ])
  const p = await vercelProjectDetails('vercel_token_1234567890', 'prj_b', 'team_1')
  assert.strictEqual(p.gitUrl, 'https://github.com/acme/shop.git')
  assert.deepStrictEqual(p.overrides, { appDir: 'web', buildCommand: '', outputDir: 'dist' })
  assert.ok(p.notes.some(n => /chains several commands/.test(n)))
  assert.deepStrictEqual(p.domains, ['shop.acme.com'])
  assert.deepStrictEqual(p.missingEnv, ['STRIPE_SECRET'])
  assert.strictEqual(p.supabaseRef, REF)
  assert.ok(p.envText.includes(`VITE_SUPABASE_URL=https://${REF}.supabase.co`))
  assert.ok(p.envText.includes('MULTI="line1\\nline2 \\"q\\""'))
  assert.ok(p.envText.includes('STRIPE_SECRET='))
  assert.ok(!/PREVIEW_ONLY|VERCEL_URL/.test(p.envText))
  assert.strictEqual(supabaseRefFromEnv([{ value: 'nothing' }]), null)
})

await test('Vercel: a rejected token is reported clearly; malformed tokens never reach the API', async () => {
  const calls = fakeApi([[/./, () => [403, { error: { message: 'Not authorized' } }]]])
  await rejects(() => vercelProjectDetails('vercel_token_1234567890', 'prj_b'), /Vercel rejected the token/)
  const before = calls.length
  await rejects(() => listVercelProjects('bad token; rm -rf'), /does not look like/)
  await rejects(() => vercelProjectDetails('vercel_token_1234567890', '../../x'), /Invalid Vercel project/)
  assert.strictEqual(calls.length, before)
})

// ------------------------------------------------------------------ Supabase Management API (fake)
await test('Supabase: project list and details (session pooler, legacy keys, JWT secret, functions, secret names)', async () => {
  const keys = stack.mintKeys(SECRET, REF)
  fakeApi([
    [/^\/v1\/projects$/, () => [200, [{ ref: REF, name: 'Shop', region: 'eu-central-1', status: 'ACTIVE_HEALTHY', organization_slug: 'acme', database: { version: '17.4' } }, { ref: 'BAD REF', name: 'x' }]]],
    [new RegExp(`^/v1/projects/${REF}$`), () => [200, { ref: REF, name: 'Shop', region: 'eu-central-1', status: 'ACTIVE_HEALTHY' }]],
    [/\/api-keys\?reveal=true$/, () => [200, [{ name: 'anon', type: 'legacy', api_key: keys.anon }, { name: 'service_role', type: 'legacy', api_key: keys.service_role }, { name: 'default', type: 'secret', api_key: 'sb_secret_abc' }]]],
    [/\/postgrest$/, () => [200, { db_schema: 'public', max_rows: 1000, jwt_secret: SECRET }]],
    [/\/config\/auth$/, () => [200, { site_url: 'https://shop.acme.com', disable_signup: false }]],
    [/\/config\/database\/pooler$/, () => [200, [{ database_type: 'PRIMARY', pool_mode: 'transaction', db_host: 'aws-0-eu-central-1.pooler.supabase.com', db_port: 6543, db_user: `postgres.${REF}`, db_name: 'postgres' }]]],
    [/\/functions$/, () => [200, [{ slug: 'hello', name: 'hello', verify_jwt: true, status: 'ACTIVE' }, { slug: 'webhook', name: 'webhook', verify_jwt: false, status: 'ACTIVE' }]]],
    [/\/secrets$/, () => [200, [{ name: 'OPENAI_KEY', value: 'digest' }, { name: 'SUPABASE_URL', value: 'digest' }]]]
  ])
  const list = await listSupabaseProjects('sbp_0123456789abcdef0123456789')
  assert.deepStrictEqual(list.map(p => p.ref), [REF])
  const d = await supabaseProjectDetails('sbp_0123456789abcdef0123456789', REF)
  assert.strictEqual(d.poolerTemplate, `postgresql://postgres.${REF}:{password}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`)
  assert.deepStrictEqual(d.keys, keys)
  assert.strictEqual(d.storageKey, keys.service_role)
  assert.strictEqual(d.jwtSecret, SECRET)
  assert.deepStrictEqual(d.functions.filter(f => !f.verifyJwt).map(f => f.slug), ['webhook'])
  assert.deepStrictEqual(d.secretNames, ['OPENAI_KEY'])
  assert.strictEqual(d.url, `https://${REF}.supabase.co`)
})

await test('Supabase: optional endpoints may fail; a bad token is reported', async () => {
  fakeApi([[new RegExp(`^/v1/projects/${REF}$`), () => [200, { ref: REF, name: 'Shop' }]]])
  const d = await supabaseProjectDetails('sbp_0123456789abcdef0123456789', REF)
  assert.strictEqual(d.jwtSecret, null)
  assert.strictEqual(d.storageKey, null)
  assert.ok(d.poolerTemplate.includes('{password}'))
  fakeApi([[/./, () => [401, { message: 'Unauthorized' }]]])
  await rejects(() => listSupabaseProjects('sbp_0123456789abcdef0123456789'), /rejected the access token/)
  await rejects(() => supabaseProjectDetails('sbp_0123456789abcdef0123456789', 'Not A Ref'), /Invalid Supabase project reference/)
  assert.ok(poolerTemplate([], REF).includes(`postgres.${REF}`))
})

globalThis.fetch = realFetch
fs.rmSync(TEST_DIR, { recursive: true, force: true })
console.log(`\n${passed} passed`)
