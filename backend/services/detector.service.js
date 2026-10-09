import fs from 'fs'
import path from 'path'

/**
 * Project stack detector.
 *
 * Works on a real file listing plus manifest contents (package.json, composer.json, …), so it
 * gives the same answer for an uploaded archive, a GitHub checkout or a directory on a server.
 * Root-level manifests win over nested ones; frontend/ + backend/ style monorepos are
 * recognised; every decision is explained in `evidence`.
 *
 * Plan types (what the deploy pipeline knows how to run):
 *   static      plain HTML served by nginx
 *   spa         JS app that builds to static files (Vite, CRA, Vue, Angular, …)
 *   node-ssr    Node app server that renders pages (Next.js, Nuxt, Remix, SvelteKit-node, …)
 *   node-server Node API / web server (Express, Fastify, NestJS, Koa, …)
 *   fullstack   spa (served by nginx) + node-server (proxied under /api)
 *   php         PHP app (Laravel, Symfony, WordPress, plain PHP) via PHP-FPM
 *   python      Django / Flask / FastAPI via gunicorn/uvicorn
 *   go | java | ruby
 */

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.nuxt', '.output', '.svelte-kit', 'venv', '.venv', '__pycache__', 'target', '.cache', 'coverage', '.idea', '.vscode'])
const FRONTEND_DIRS = ['frontend', 'client', 'web', 'ui', 'app', 'site']
const BACKEND_DIRS = ['backend', 'server', 'api', 'service']
const MANIFESTS = ['package.json', 'composer.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'angular.json', 'prisma/schema.prisma', '.env.example', '.env.sample', 'manage.py']

/** Lists files under a local directory (relative POSIX paths), skipping dependency/build dirs. */
export function listLocalFiles(root, { maxDepth = 5, maxFiles = 8000 } = {}) {
  const out = []
  const walk = (dir, rel, depth) => {
    if (out.length >= maxFiles) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (out.length >= maxFiles) return
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) { out.push(`${r}/`); continue }
        if (depth < maxDepth) walk(path.join(dir, e.name), r, depth + 1)
      } else if (e.isFile()) {
        out.push(r)
      }
    }
  }
  walk(root, '', 1)
  return out
}

export function localReader(root) {
  return (rel) => {
    try {
      const abs = path.join(root, rel)
      if (fs.statSync(abs).size > 512 * 1024) return null
      return fs.readFileSync(abs, 'utf8')
    } catch {
      return null
    }
  }
}

/** Manifest paths worth reading for a given file listing (root + common app subdirs). */
export function manifestPaths(files) {
  const set = new Set(files)
  const dirs = ['', ...FRONTEND_DIRS, ...BACKEND_DIRS]
  const wanted = []
  for (const d of dirs) for (const m of MANIFESTS) {
    const p = d ? `${d}/${m}` : m
    if (set.has(p)) wanted.push(p)
  }
  // Python entry candidates and Django wsgi modules
  for (const f of files) {
    if (/(^|\/)(app|main|wsgi|run|server|application)\.py$/.test(f) && f.split('/').length <= 2) wanted.push(f)
    if (/(^|\/)vite\.config\.(js|ts|mjs|cjs)$/.test(f) && f.split('/').length <= 2) wanted.push(f)
  }
  return [...new Set(wanted)]
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

const SPA_DEPS = ['vite', 'react-scripts', '@vue/cli-service', '@angular/core', '@angular/cli', 'parcel', 'gatsby', 'svelte', 'preact', 'solid-js', 'webpack-cli', '@sveltejs/vite-plugin-svelte']
const SERVER_DEPS = ['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'hono', '@hono/node-server', 'restify', 'socket.io', 'apollo-server', '@apollo/server', 'feathers', '@adonisjs/core', 'sails', 'loopback']

function detectNode(prefix, pkg, has, read, evidence) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const depNames = Object.keys(deps)
  const scripts = pkg.scripts || {}
  const at = prefix ? `${prefix}/package.json` : 'package.json'
  const file = (f) => (prefix ? `${prefix}/${f}` : f)

  if (deps.next) {
    evidence.push(`${at} depends on next@${deps.next}`)
    return { type: 'node-ssr', framework: 'Next.js', build: scripts.build ? 'npm run build' : 'npx next build', start: scripts.start ? 'npm run start' : 'npx next start', port: 3000 }
  }
  if (deps.nuxt || deps.nuxt3) {
    evidence.push(`${at} depends on nuxt`)
    return { type: 'node-ssr', framework: 'Nuxt', build: 'npm run build', start: 'node .output/server/index.mjs', port: 3000 }
  }
  if (depNames.some(d => d.startsWith('@remix-run/'))) {
    evidence.push(`${at} depends on Remix`)
    return { type: 'node-ssr', framework: 'Remix', build: 'npm run build', start: scripts.start ? 'npm run start' : 'npx remix-serve build/server/index.js', port: 3000 }
  }
  if (deps['@sveltejs/kit']) {
    if (deps['@sveltejs/adapter-node']) {
      evidence.push(`${at} uses SvelteKit with adapter-node`)
      return { type: 'node-ssr', framework: 'SvelteKit', build: 'npm run build', start: 'node build', port: 3000 }
    }
    evidence.push(`${at} uses SvelteKit (static output)`)
    return { type: 'spa', framework: 'SvelteKit', build: 'npm run build', outputDir: 'build' }
  }
  if (deps.astro) {
    if (deps['@astrojs/node']) {
      evidence.push(`${at} uses Astro with the Node adapter`)
      return { type: 'node-ssr', framework: 'Astro (SSR)', build: 'npm run build', start: 'node dist/server/entry.mjs', port: 4321 }
    }
    evidence.push(`${at} depends on astro`)
    return { type: 'spa', framework: 'Astro', build: 'npm run build', outputDir: 'dist' }
  }

  const server = SERVER_DEPS.find(d => deps[d])
  if (server) {
    evidence.push(`${at} depends on ${server}`)
    const isNest = !!deps['@nestjs/core']
    const entryCandidates = [pkg.main, 'server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js', 'src/app.js', 'server.mjs', 'index.mjs'].filter(Boolean)
    const entry = entryCandidates.find(f => has(file(f)))
    let start
    if (isNest) start = scripts['start:prod'] ? 'npm run start:prod' : 'node dist/main.js'
    else if (scripts.start && !/nodemon|--watch|ts-node-dev/.test(scripts.start)) start = 'npm run start'
    else if (entry) start = `node ${entry}`
    else start = 'npm run start'
    const needsBuild = !!scripts.build && (isNest || !!deps.typescript)
    if (entry) evidence.push(`entry point ${file(entry)}`)
    return {
      type: 'node-server',
      framework: isNest ? 'NestJS' : ({ express: 'Express', fastify: 'Fastify', koa: 'Koa', '@hapi/hapi': 'hapi', hono: 'Hono' }[server] || 'Node.js server'),
      build: needsBuild ? 'npm run build' : '',
      start,
      port: 5000
    }
  }

  const spa = SPA_DEPS.find(d => deps[d])
  if (spa && scripts.build) {
    evidence.push(`${at} depends on ${spa} and has a build script`)
    let outputDir = 'dist'
    let framework = 'Vite app'
    if (deps['react-scripts']) { outputDir = 'build'; framework = 'Create React App' }
    else if (deps['@angular/core']) {
      framework = 'Angular'
      const angular = parseJson(read(file('angular.json')) || '')
      const proj = angular && Object.values(angular.projects || {})[0]
      const outPath = proj?.architect?.build?.options?.outputPath
      outputDir = typeof outPath === 'string' ? outPath : (outPath?.base || 'dist')
      if (deps['@angular/build'] || deps['@angular-devkit/build-angular']?.match(/^[\^~]?(1[7-9]|[2-9]\d)/)) outputDir += '/browser'
    } else if (deps.gatsby) { outputDir = 'public'; framework = 'Gatsby' }
    else if (deps['@vue/cli-service']) framework = 'Vue CLI'
    else if (deps.vite) {
      framework = deps.react ? 'React (Vite)' : deps.vue ? 'Vue (Vite)' : deps.svelte ? 'Svelte (Vite)' : 'Vite app'
      const viteCfg = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs'].map(file).map(read).find(Boolean)
      const m = viteCfg && viteCfg.match(/outDir\s*:\s*['"`]([^'"`]+)['"`]/)
      if (m) { outputDir = m[1].replace(/^\.\//, ''); evidence.push(`vite outDir is ${outputDir}`) }
    } else if (deps.react) framework = 'React app'
    return { type: 'spa', framework, build: 'npm run build', outputDir }
  }

  if (scripts.start) {
    evidence.push(`${at} has a start script (${scripts.start.slice(0, 60)})`)
    return { type: 'node-server', framework: 'Node.js app', build: scripts.build ? 'npm run build' : '', start: 'npm run start', port: 5000 }
  }
  if (scripts.build && has(file('index.html'))) {
    evidence.push(`${at} has a build script and index.html`)
    return { type: 'spa', framework: 'JavaScript app', build: 'npm run build', outputDir: 'dist' }
  }
  return null
}

function detectPhp(prefix, has, read, evidence) {
  const file = (f) => (prefix ? `${prefix}/${f}` : f)
  const composer = parseJson(read(file('composer.json')) || '')
  const req = { ...(composer?.require || {}), ...(composer?.['require-dev'] || {}) }
  if (has(file('artisan')) || req['laravel/framework']) {
    evidence.push(has(file('artisan')) ? `${file('artisan')} present` : 'composer.json requires laravel/framework')
    return { type: 'php', framework: 'Laravel', webRoot: 'public', composer: true, laravel: true }
  }
  if (has(file('wp-config.php')) || has(file('wp-config-sample.php')) || has(file('wp-includes/version.php')) || has(file('wp-login.php'))) {
    evidence.push('WordPress core files present')
    return { type: 'php', framework: 'WordPress', webRoot: '', composer: false, wordpress: true }
  }
  if (req['symfony/framework-bundle']) {
    evidence.push('composer.json requires symfony/framework-bundle')
    return { type: 'php', framework: 'Symfony', webRoot: 'public', composer: true }
  }
  if (composer) {
    evidence.push(`${file('composer.json')} present`)
    return { type: 'php', framework: 'PHP (Composer)', webRoot: has(file('public/index.php')) ? 'public' : '', composer: true }
  }
  if (has(file('index.php')) || has(file('public/index.php'))) {
    evidence.push(`${has(file('index.php')) ? file('index.php') : file('public/index.php')} present`)
    return { type: 'php', framework: 'PHP', webRoot: !has(file('index.php')) && has(file('public/index.php')) ? 'public' : '', composer: false }
  }
  return null
}

function detectPython(prefix, files, has, read, evidence) {
  const file = (f) => (prefix ? `${prefix}/${f}` : f)
  const reqs = [read(file('requirements.txt')), read(file('pyproject.toml')), read(file('Pipfile'))].filter(Boolean).join('\n').toLowerCase()
  if (has(file('manage.py'))) {
    const wsgi = files.find(f => f.startsWith(prefix ? `${prefix}/` : '') && /\/wsgi\.py$/.test(f) && f.split('/').length - (prefix ? prefix.split('/').length : 0) === 2)
    const module = wsgi ? wsgi.slice(prefix ? prefix.length + 1 : 0).replace(/\.py$/, '').replace(/\//g, '.') : null
    evidence.push(`${file('manage.py')} present${module ? `, WSGI module ${module}` : ''}`)
    return { type: 'python', framework: 'Django', start: `gunicorn ${module || 'config.wsgi'}:application`, django: true, port: 8000 }
  }
  if (!reqs && !['app.py', 'main.py', 'wsgi.py'].some(f => has(file(f)))) return null
  const entries = ['main.py', 'app.py', 'wsgi.py', 'application.py', 'run.py', 'server.py'].filter(f => has(file(f)))
  for (const e of entries) {
    const src = read(file(e)) || ''
    const fast = src.match(/^(\w+)\s*=\s*FastAPI\(/m)
    if (fast || (reqs.includes('fastapi') && /FastAPI\(/.test(src))) {
      evidence.push(`${file(e)} creates a FastAPI app`)
      return { type: 'python', framework: 'FastAPI', start: `uvicorn ${e.replace('.py', '')}:${fast ? fast[1] : 'app'} --host 127.0.0.1`, uvicorn: true, port: 8000 }
    }
    const flask = src.match(/^(\w+)\s*=\s*Flask\(/m)
    if (flask) {
      evidence.push(`${file(e)} creates a Flask app`)
      return { type: 'python', framework: 'Flask', start: `gunicorn ${e.replace('.py', '')}:${flask[1]}`, port: 8000 }
    }
  }
  if (reqs) {
    const fw = reqs.includes('fastapi') ? 'FastAPI' : reqs.includes('flask') ? 'Flask' : 'Python web app'
    evidence.push(`Python dependencies found (${fw})`)
    const entry = (entries[0] || 'app.py').replace('.py', '')
    return { type: 'python', framework: fw, start: fw === 'FastAPI' ? `uvicorn ${entry}:app --host 127.0.0.1` : `gunicorn ${entry}:app`, uvicorn: fw === 'FastAPI', port: 8000 }
  }
  return null
}

function detectUnit(prefix, files, has, read, evidence) {
  const file = (f) => (prefix ? `${prefix}/${f}` : f)
  const pkg = parseJson(read(file('package.json')) || '')
  if (pkg) {
    const node = detectNode(prefix, pkg, has, read, evidence)
    if (node) return { ...node, language: 'nodejs', dir: prefix }
  }
  const php = detectPhp(prefix, has, read, evidence)
  if (php) return { ...php, language: 'php', dir: prefix }
  const py = detectPython(prefix, files, has, read, evidence)
  if (py) return { ...py, language: 'python', dir: prefix }
  if (has(file('go.mod'))) {
    evidence.push(`${file('go.mod')} present`)
    return { type: 'go', language: 'go', framework: 'Go', build: 'go build -o app .', start: './app', port: 8080, dir: prefix }
  }
  if (has(file('pom.xml')) || has(file('build.gradle')) || has(file('build.gradle.kts'))) {
    const maven = has(file('pom.xml'))
    evidence.push(`${maven ? 'pom.xml' : 'build.gradle'} present`)
    return {
      type: 'java', language: 'java', framework: maven ? 'Java (Maven)' : 'Java (Gradle)', port: 8080, dir: prefix,
      build: maven ? (has(file('mvnw')) ? './mvnw -q -DskipTests package' : 'mvn -q -DskipTests package') : (has(file('gradlew')) ? './gradlew build -x test' : 'gradle build -x test')
    }
  }
  if (has(file('Gemfile'))) {
    const rails = has(file('config/application.rb'))
    evidence.push(rails ? 'Rails app (config/application.rb)' : 'Gemfile present')
    return { type: 'ruby', language: 'ruby', framework: rails ? 'Ruby on Rails' : 'Ruby (Rack)', start: rails ? 'bundle exec rails server -b 127.0.0.1' : 'bundle exec rackup -o 127.0.0.1', port: 3000, dir: prefix }
  }
  if (has(file('index.html'))) {
    evidence.push(`${file('index.html')} present (static site)`)
    return { type: 'static', language: 'html', framework: 'Static HTML', dir: prefix }
  }
  return null
}

/** A root package.json that only orchestrates subprojects (concurrently, cd frontend && …). */
function isWrapperPackage(read) {
  const pkg = parseJson(read('package.json') || '')
  if (!pkg) return false
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
  const realDeps = deps.filter(d => !['concurrently', 'npm-run-all', 'nodemon', 'cross-env', 'prettier', 'eslint', 'husky', 'lint-staged', 'dotenv', 'rimraf', 'typescript'].includes(d))
  const scripts = Object.values(pkg.scripts || {}).join(' ')
  return !!pkg.workspaces || (realDeps.length === 0 && /(--prefix|cd )\s*(frontend|backend|client|server)/.test(scripts)) || realDeps.length === 0
}

function detectDatabase(files, read) {
  const engines = new Set()
  const hints = []
  const texts = files.filter(f => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|composer\.json|Gemfile|\.env\.example|\.env\.sample|schema\.prisma)$/.test(f)).map(f => [f, read(f) || ''])
  for (const [f, t] of texts) {
    const l = t.toLowerCase()
    if (/"(pg|postgres|pg-promise)"|psycopg|"postgresql"|provider\s*=\s*"postgresql"|db_connection=pgsql|postgres(ql)?:\/\//.test(l)) { engines.add('postgresql'); hints.push(`${f} references PostgreSQL`) }
    if (/"(mysql|mysql2)"|mysqlclient|pymysql|provider\s*=\s*"mysql"|db_connection=mysql|mysql:\/\//.test(l)) { engines.add('mysql'); hints.push(`${f} references MySQL`) }
    if (/"(mongoose|mongodb)"|pymongo|mongodb(\+srv)?:\/\//.test(l)) { engines.add('mongodb'); hints.push(`${f} references MongoDB`) }
    if (/"(sqlite3|better-sqlite3)"|provider\s*=\s*"sqlite"|db_connection=sqlite/.test(l)) { engines.add('sqlite'); hints.push(`${f} references SQLite`) }
  }
  const dumps = files.filter(f => /\.(sql|sql\.gz|dump)$/i.test(f)).slice(0, 5)
  if (dumps.length) hints.push(`Database dump(s) in the source: ${dumps.join(', ')}`)
  return { engines: [...engines], hints: [...new Set(hints)].slice(0, 8), dumps }
}

const LABELS = {
  static: 'Static website', spa: 'Single-page app', 'node-ssr': 'Node.js server-rendered app', 'node-server': 'Node.js server',
  fullstack: 'Full-stack app', php: 'PHP app', python: 'Python app', go: 'Go app', java: 'Java app', ruby: 'Ruby app', unknown: 'Unknown'
}

/**
 * @param {string[]} files  relative POSIX paths (directories that were not descended end with '/')
 * @param {(rel: string) => string|null} read  returns file contents for manifests
 */
export function analyzeProject(files, read) {
  const set = new Set(files)
  const has = (p) => set.has(p)
  const evidence = []
  const warnings = []

  let plan = null
  const rootUnit = detectUnit('', files, has, read, evidence)
  const wrapper = has('package.json') && isWrapperPackage(read)

  // SPA at the root + Node API in server/ (or a Node server at the root + SPA in client/)
  const pairEvidence = []
  const subBackend = () => BACKEND_DIRS.filter(d => has(`${d}/package.json`)).map(d => detectUnit(d, files, has, read, pairEvidence)).find(u => u?.type === 'node-server')
  const subFrontend = () => FRONTEND_DIRS.filter(d => has(`${d}/package.json`)).map(d => detectUnit(d, files, has, read, pairEvidence)).find(u => u?.type === 'spa')
  const pairedBackend = rootUnit?.type === 'spa' && !wrapper ? subBackend() : null
  const pairedFrontend = rootUnit?.type === 'node-server' && !wrapper && !pairedBackend ? subFrontend() : null

  if (pairedBackend || pairedFrontend) {
    const fe = pairedBackend ? rootUnit : pairedFrontend
    const be = pairedBackend || rootUnit
    evidence.push(...pairEvidence)
    plan = { type: 'fullstack', language: 'nodejs', framework: `${fe.framework} + ${be.framework}`, frontend: fe, backend: be, port: be.port }
    evidence.push(`Frontend in ${fe.dir || 'the project root'}, backend in ${be.dir || 'the project root'}`)
  } else if (rootUnit && !(wrapper && rootUnit.language === 'nodejs') && rootUnit.type !== 'static') {
    plan = { ...rootUnit }
  } else {
    const subEvidence = []
    const fe = FRONTEND_DIRS.filter(d => has(`${d}/package.json`) || has(`${d}/index.html`)).map(d => detectUnit(d, files, has, read, subEvidence)).find(u => u && ['spa', 'static', 'node-ssr'].includes(u.type))
    const be = BACKEND_DIRS.filter(d => [...MANIFESTS, 'index.php', 'artisan'].some(m => has(`${d}/${m}`))).map(d => detectUnit(d, files, has, read, subEvidence)).find(u => u && !['spa', 'static'].includes(u.type))
    evidence.push(...subEvidence)
    if (fe && be && fe.type !== 'node-ssr' && be.language === 'nodejs') {
      plan = { type: 'fullstack', language: 'nodejs', framework: `${fe.framework} + ${be.framework}`, frontend: fe, backend: be, port: be.port }
      evidence.push(`Monorepo: frontend in ${fe.dir}/, backend in ${be.dir}/`)
    } else if (be && fe) {
      plan = { ...be }
      warnings.push(`Found a frontend in ${fe.dir}/ and a ${be.framework} backend in ${be.dir}/; deploying the backend. Build the frontend into the backend's public folder if it serves it.`)
    } else if (be || fe) {
      plan = { ...(be || fe) }
    } else if (rootUnit) {
      plan = { ...rootUnit }
    }
  }

  if (!plan) {
    plan = { type: 'unknown', language: 'unknown', framework: 'Not recognised', dir: '' }
    warnings.push('No package.json, composer.json, requirements.txt, go.mod, pom.xml, Gemfile or index.html was found at the top of the project or in frontend/, backend/, server/ or client/. If the archive contains a single folder, that is handled automatically — otherwise check that you uploaded the project root.')
  }

  if (plan.type === 'php' && !plan.wordpress && has('package.json') && plan.laravel) evidence.push('Laravel front-end assets (package.json) will be built with npm when a build script exists')

  return {
    ...plan,
    label: LABELS[plan.type] || plan.type,
    port: plan.port || null,
    evidence: [...new Set(evidence)],
    warnings,
    database: detectDatabase(files, read),
    fileCount: files.filter(f => !f.endsWith('/')).length
  }
}

/** Convenience for a local directory. */
export function analyzeLocalDir(root) {
  const files = listLocalFiles(root)
  return analyzeProject(files, localReader(root))
}

// Back-compat wrapper for old callers that pass a flat file list
export function detectProjectStack(fileList = [], packageJsonContent = null, composerJsonContent = null) {
  const contents = {}
  if (packageJsonContent) contents['package.json'] = JSON.stringify(packageJsonContent)
  if (composerJsonContent) contents['composer.json'] = JSON.stringify(composerJsonContent)
  return analyzeProject(fileList, (rel) => contents[rel] ?? null)
}
