import { Router } from 'express'
import { fail, okItem, okMessage } from '../utils/response.js'
import { generateLabels, generateSingleLabel, LABEL_HEIGHT_MM, LABEL_WIDTH_MM } from '../services/labels.js'
import { assertRecordDomainAccess, loadItemDomain } from '../services/domainAuth.js'

const router = Router()

router.get('/templates', (_req, res) => {
  return okItem(res, {
    rows: [
      {
        name: '36x30 mm',
        unit: 'mm',
        width: LABEL_WIDTH_MM,
        height: LABEL_HEIGHT_MM,
        support_1d_barcode: false,
        support_2d_barcode: true,
        fields: ['asset_tag', 'company'],
      },
    ],
  })
})

/** POST { asset_tags: string[] } → PNG sticker(s), 36 × 30 mm at 600 DPI */
router.post('/', async (req, res) => {
  const tags = req.body?.asset_tags || req.body?.assets || []
  if (!Array.isArray(tags) || !tags.length) return fail(res, 'asset_tags array required')
  try {
    const result = await generateLabels(tags, { userId: req.user?.id, permissions: req.user?.permissions })
    return okItem(res, result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Label generation failed'
    return fail(res, msg, /Forbidden/i.test(msg) ? 403 : 400)
  }
})

router.get('/hardware/:id', async (req, res) => {
  const row = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [Number(req.params.id)])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  try {
    const result = await generateSingleLabel(Number(req.params.id), { userId: req.user?.id })
    if (req.query.download === '1') {
      const buf = Buffer.from(result.image_base64, 'base64')
      res.setHeader('Content-Type', result.mime)
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      return res.send(buf)
    }
    return okItem(res, result)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Label generation failed')
  }
})

router.post('/hardware/:id', async (req, res) => {
  const row = await loadItemDomain('assets', 'id = ? AND deleted_at IS NULL', [Number(req.params.id)])
  if (!row) return fail(res, 'Asset not found', 404)
  if (!(await assertRecordDomainAccess(req, res, row.domain_id))) return
  try {
    const result = await generateSingleLabel(Number(req.params.id), { userId: req.user?.id })
    return okMessage(res, 'Print label generated', result)
  } catch (e) {
    return fail(res, e instanceof Error ? e.message : 'Label generation failed')
  }
})

export default router
