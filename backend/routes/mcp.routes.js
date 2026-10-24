import express from 'express'
import { recordAuditLog } from '../services/db.service.js'
import { authenticateMcpToken, handleRpc, isWriteTool } from '../services/mcp.service.js'
import { createRateLimiter, clientIp } from '../middleware/rateLimit.middleware.js'

/**
 * The MCP endpoint AI clients connect to (Streamable HTTP transport, JSON responses).
 * Authenticated with a project MCP token, not a panel session (see services/mcp.service.js).
 */
const router = express.Router()

const failedAuth = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 })
const perToken = createRateLimiter({ windowMs: 60 * 1000, max: 300 })

const rpcError = (res, status, code, message, headers = {}) => res.status(status).set(headers).json({ jsonrpc: '2.0', id: null, error: { code, message } })

router.post('/', async (req, res) => {
  const ip = clientIp(req)
  const auth = String(req.headers.authorization || '')
  const raw = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''

  let ctx
  try {
    ctx = authenticateMcpToken(raw)
  } catch (err) {
    const { allowed, retryAfterSec } = failedAuth.hit(ip)
    if (!allowed) return rpcError(res, 429, -32000, 'Too many failed attempts. Try again later.', { 'Retry-After': String(retryAfterSec) })
    const status = err.status || 401
    return rpcError(res, status, -32001, err.message, status === 401 ? { 'WWW-Authenticate': 'Bearer realm="autodeploy-mcp"' } : {})
  }

  const limit = perToken.hit(ctx.token.id)
  if (!limit.allowed) return rpcError(res, 429, -32000, 'Too many requests for this MCP token. Slow down.', { 'Retry-After': String(limit.retryAfterSec) })

  const onToolCall = (name, args, isError) => {
    if (!isWriteTool(name)) return
    recordAuditLog({
      organizationId: ctx.token.organizationId,
      userId: ctx.token.userId,
      action: 'MCP_TOOL_CALL',
      resourceType: 'mcp_token',
      resourceId: ctx.token.id,
      ip,
      details: { tool: name, path: args.path || args.app_name || null, projectPath: ctx.token.projectPath, failed: isError }
    })
  }

  const body = req.body
  const batch = Array.isArray(body)
  const messages = batch ? body : [body]
  if (!messages.length || messages.some((m) => !m || typeof m !== 'object')) return rpcError(res, 400, -32700, 'Expected a JSON-RPC message.')

  const responses = []
  for (const msg of messages) {
    const reply = await handleRpc(ctx, msg, onToolCall)
    if (reply) responses.push(reply)
  }
  // Only notifications or responses: nothing to answer
  if (!responses.length) return res.status(202).end()
  res.json(batch ? responses : responses[0])
})

// This server never pushes messages, so there is no SSE stream to open and no session to end
router.get('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST for MCP requests.' }))
router.delete('/', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'This MCP server does not keep sessions.' }))

export default router
