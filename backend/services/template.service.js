import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { readDb, writeDb } from './db.service.js'
import { getReadyUpload, analyzeGitRepo, validateGitUrl } from './upload.service.js'

/**
 * Marketplace templates, managed by super admins and deployed by organization admins.
 *
 * A template's source is either a Git repository or an uploaded archive (.zip/.tar.gz/.tgz/.tar)
 * kept in data/templates/<id>/. Its stack is analyzed once when the source is set, so the deploy
 * wizard can start straight from the template's defaults.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_ROOT = path.resolve(__dirname, '../data/templates')

export const TEMPLATE_CATEGORIES = ['saas', 'web', 'landing', 'ecommerce', 'blog', 'api', 'other']
const APP_TYPES = ['static', 'spa', 'node-ssr', 'node-server', 'fullstack', 'php', 'python', 'go', 'java', 'ruby'] // same as the deploy pipeline
const DB_ENGINES = ['postgresql', 'mysql', 'mongodb', 'sqlite']
const ACCENTS = ['cyan', 'purple', 'emerald', 'amber', 'rose', 'indigo']

const httpError = (status, message) => Object.assign(new Error(message), { status })

function text(value, max, label, { required = false } = {}) {
  const v = String(value ?? '').trim()
  if (required && !v) throw httpError(400, `${label} is required.`)
  if (v.length > max) throw httpError(400, `${label} must be at most ${max} characters.`)
  return v
}

function optionalUrl(value, label) {
  const v = text(value, 500, label)
  if (v && !/^https?:\/\/[^\s"'<>]+$/i.test(v)) throw httpError(400, `${label} must start with http:// or https://`)
  return v
}

function relDir(value, label) {
  const v = text(value, 200, label)
  if (v && (v.startsWith('/') || v.split('/').includes('..') || !/^[A-Za-z0-9._\/-]+$/.test(v))) throw httpError(400, `${label} must be a folder inside the project.`)
  return v
}

function command(value, label) {
  const v = text(value, 300, label)
  if (/[\r\n`]|\$\(/.test(v)) throw httpError(400, `${label} contains characters that aren't allowed.`)
  return v
}

/** Validates the editable fields; `partial` keeps fields that weren't sent. */
function cleanInput(input = {}, current = null) {
  const pick = (key, fn) => (input[key] === undefined && current ? current[key] : fn(input[key]))
  const d = input.defaults || {}
  const cd = current?.defaults || {}
  const pickD = (key, fn) => (d[key] === undefined ? cd[key] ?? fn(undefined) : fn(d[key]))

  const port = pickD('port', (v) => {
    if (v === undefined || v === null || v === '') return null
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1024 || n > 65000) throw httpError(400, 'Default port must be between 1024 and 65000.')
    return n
  })

  return {
    name: pick('name', (v) => text(v, 80, 'Name', { required: true })),
    description: pick('description', (v) => text(v, 1000, 'Description')),
    category: pick('category', (v) => (TEMPLATE_CATEGORIES.includes(v) ? v : 'other')),
    technologies: pick('technologies', (v) => (Array.isArray(v) ? v : String(v || '').split(','))
      .map((t) => String(t).trim()).filter(Boolean).slice(0, 12).map((t) => t.slice(0, 30))),
    previewUrl: pick('previewUrl', (v) => optionalUrl(v, 'Preview URL')),
    thumbnailUrl: pick('thumbnailUrl', (v) => optionalUrl(v, 'Thumbnail URL')),
    accent: pick('accent', (v) => (ACCENTS.includes(v) ? v : 'cyan')),
    featured: pick('featured', (v) => !!v),
    status: pick('status', (v) => (v === 'published' ? 'published' : 'draft')),
    defaults: {
      type: pickD('type', (v) => (APP_TYPES.includes(v) ? v : 'auto')),
      buildCommand: pickD('buildCommand', (v) => command(v, 'Build command')),
      startCommand: pickD('startCommand', (v) => command(v, 'Start command')),
      outputDir: pickD('outputDir', (v) => relDir(v, 'Output folder')),
      appDir: pickD('appDir', (v) => relDir(v, 'App folder')),
      port,
      envVars: pickD('envVars', (v) => text(v, 20000, 'Default environment variables')),
      database: pickD('database', (v) => (DB_ENGINES.includes(v) ? v : 'none'))
    }
  }
}

function templateDir(id) {
  return path.join(TEMPLATE_ROOT, id)
}

/** Copies a finished source upload into the template's own folder (uploads are cleaned up later). */
function storeArchive(id, uploadId, userId) {
  const up = getReadyUpload(uploadId, userId, 'source')
  fs.mkdirSync(templateDir(id), { recursive: true })
  const file = path.join(templateDir(id), `source${up.ext}`)
  for (const old of fs.readdirSync(templateDir(id))) if (old.startsWith('source.')) fs.rmSync(path.join(templateDir(id), old), { force: true })
  fs.copyFileSync(up.file, file)
  return { source: { type: 'archive', file, ext: up.ext, fileName: up.name, size: up.size }, analysis: up.analysis || null }
}

async function resolveSource(id, input, userId, githubToken) {
  if (input.uploadId) return storeArchive(id, input.uploadId, userId)
  if (input.gitUrl) {
    const gitUrl = validateGitUrl(input.gitUrl)
    const branch = text(input.branch || 'main', 100, 'Branch')
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(branch)) throw httpError(400, 'Invalid branch name.')
    const result = await analyzeGitRepo({ gitUrl, branch, token: githubToken || null })
    return { source: { type: 'git', gitUrl, branch: result.branch || branch }, analysis: result.analysis || null }
  }
  return null
}

/** What customers see: no server-side file paths. */
export function publicTemplate(t) {
  if (!t) return null
  const { source, createdBy, ...rest } = t
  return {
    ...rest,
    source: source?.type === 'git'
      ? { type: 'git', gitUrl: source.gitUrl, branch: source.branch }
      : source ? { type: 'archive', fileName: source.fileName, size: source.size } : null
  }
}

export function listTemplates({ publishedOnly = false } = {}) {
  return Object.values(readDb().templates || {})
    .filter((t) => !publishedOnly || t.status === 'published')
    .sort((a, b) => (b.featured - a.featured) || (b.deployCount || 0) - (a.deployCount || 0) || new Date(b.createdAt) - new Date(a.createdAt))
}

export function getTemplate(id) {
  return (readDb().templates || {})[id] || null
}

export async function createTemplate(input, { userId, githubToken }) {
  const fields = cleanInput(input)
  const id = `tpl-${crypto.randomBytes(6).toString('hex')}`
  const resolved = await resolveSource(id, input, userId, githubToken)
  if (!resolved) throw httpError(400, 'Add a source: a Git repository URL or an uploaded archive.')
  const now = new Date().toISOString()
  const template = { id, ...fields, ...resolved, deployCount: 0, createdBy: userId, createdAt: now, updatedAt: now }
  const db = readDb()
  if (!db.templates) db.templates = {}
  db.templates[id] = template
  writeDb(db)
  return template
}

export async function updateTemplate(id, input, { userId, githubToken }) {
  const current = getTemplate(id)
  if (!current) throw httpError(404, 'Template not found.')
  const fields = cleanInput(input, current)
  const resolved = await resolveSource(id, input, userId, githubToken)
  const db = readDb()
  const saved = { ...db.templates[id], ...fields, ...(resolved || {}), updatedAt: new Date().toISOString() }
  // Switching from an archive to Git drops the stored archive
  if (resolved?.source.type === 'git' && current.source?.type === 'archive') fs.rmSync(templateDir(id), { recursive: true, force: true })
  db.templates[id] = saved
  writeDb(db)
  return saved
}

export function deleteTemplate(id) {
  const db = readDb()
  const t = (db.templates || {})[id]
  if (!t) throw httpError(404, 'Template not found.')
  delete db.templates[id]
  writeDb(db)
  fs.rmSync(templateDir(id), { recursive: true, force: true })
  return t
}

/**
 * Deploy source for validateDeployConfig. Organization users can only deploy published templates.
 */
export function templateDeploySource(templateId, { allowDraft = false } = {}) {
  const t = getTemplate(String(templateId || ''))
  if (!t || (t.status !== 'published' && !allowDraft)) throw httpError(404, 'Template not found.')
  if (t.source?.type === 'git') return { templateId: t.id, src: { type: 'git', gitUrl: t.source.gitUrl, branch: t.source.branch || 'main' } }
  if (t.source?.type === 'archive' && fs.existsSync(t.source.file)) {
    return { templateId: t.id, src: { type: 'upload', file: t.source.file, ext: t.source.ext, name: t.source.fileName } }
  }
  throw httpError(400, 'This template has no deployable source. Ask the platform team to re-upload it.')
}

export function recordTemplateDeploy(templateId) {
  const db = readDb()
  const t = (db.templates || {})[templateId]
  if (!t) return
  t.deployCount = (t.deployCount || 0) + 1
  writeDb(db)
}
