import express from 'express'
import { authenticateToken } from '../middleware/auth.middleware.js'
import { listTemplates, getTemplate, publicTemplate, TEMPLATE_CATEGORIES } from '../services/template.service.js'

/**
 * Marketplace catalog for signed-in users: published templates only.
 * Deploying one goes through POST /api/deploy/deploy with source { type: 'template', templateId }.
 */
const router = express.Router()

router.use(authenticateToken)

router.get('/', (req, res) => {
  res.json({ success: true, categories: TEMPLATE_CATEGORIES, templates: listTemplates({ publishedOnly: true }).map(publicTemplate) })
})

router.get('/:id', (req, res) => {
  const t = getTemplate(req.params.id)
  if (!t || t.status !== 'published') return res.status(404).json({ success: false, error: 'Template not found.' })
  res.json({ success: true, template: publicTemplate(t) })
})

export default router
