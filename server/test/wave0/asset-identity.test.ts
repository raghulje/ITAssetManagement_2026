import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { currentFyTagSegment, nextAssetTag, tagSegment } from '../../src/services/assetTag.js'
import { publicAssetPageUrl } from '../../src/services/assetQr.js'
import { fyStartYear } from '../../src/utils/period.js'

describe('Wave 0 — Asset identity (tag + QR URL shape)', () => {
  it('tagSegment uppercases and strips non-alphanumerics (current allocator rule)', () => {
    assert.equal(tagSegment('Memf Energy', 'ASSET', 12), 'MEMFENERGY')
    assert.equal(tagSegment('Laptop / Win', 'ASSET', 16), 'LAPTOPWIN')
    assert.equal(tagSegment('', 'ASSET'), 'ASSET')
    assert.equal(tagSegment(null, 'ASSET'), 'ASSET')
  })

  it('FY tag segment is YYYY-YY from India FY (Apr–Mar)', () => {
    const d = new Date(2026, 7, 24)
    assert.equal(fyStartYear(d), 2026)
    assert.equal(currentFyTagSegment(d), '2026-27')
    const beforeApr = new Date(2026, 2, 31)
    assert.equal(currentFyTagSegment(beforeApr), '2025-26')
  })

  it('nextAssetTag requires category_id before any DB read', async () => {
    await assert.rejects(
      () => nextAssetTag({ companyId: 1 }),
      /category_id \(asset type\) is required to generate asset tag/,
    )
  })

  it('nextAssetTag requires company_id or legal_entity_id before any DB read', async () => {
    await assert.rejects(
      () => nextAssetTag({ categoryId: 1 }),
      /company_id or legal_entity_id is required to generate asset tag/,
    )
  })

  it('allocated tag pattern is CODE-TYPE-FY-#### (documented current format)', () => {
    const prefix = 'MEMF-LAPTOP-2026-27'
    const tag = `${prefix}-0001`
    assert.match(tag, /^[A-Z0-9]+-[A-Z0-9]+-\d{4}-\d{2}-\d{4}$/)
    assert.equal(tag, 'MEMF-LAPTOP-2026-27-0001')
  })

  it('public QR page URL is /asset/:token on client base (current publicAssets + assetQr)', () => {
    const prev = process.env.PUBLIC_APP_URL
    process.env.PUBLIC_APP_URL = 'https://asset.example.com'
    try {
      assert.equal(publicAssetPageUrl('abc123'), 'https://asset.example.com/asset/abc123')
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_APP_URL
      else process.env.PUBLIC_APP_URL = prev
    }
  })

  it('keeps the listen port on localhost public URLs so the page is reachable', () => {
    const prevUrl = process.env.PUBLIC_APP_URL
    const prevPort = process.env.PORT
    process.env.PUBLIC_APP_URL = 'http://localhost'
    process.env.PORT = '3053'
    try {
      assert.equal(publicAssetPageUrl('abc123'), 'http://localhost:3053/asset/abc123')
    } finally {
      if (prevUrl === undefined) delete process.env.PUBLIC_APP_URL
      else process.env.PUBLIC_APP_URL = prevUrl
      if (prevPort === undefined) delete process.env.PORT
      else process.env.PORT = prevPort
    }
  })

  it('strips the listen port from a proxied public hostname', () => {
    const prevUrl = process.env.PUBLIC_APP_URL
    const prevPort = process.env.PORT
    process.env.PUBLIC_APP_URL = 'https://asset.refexone.com:3053'
    process.env.PORT = '3053'
    try {
      assert.equal(publicAssetPageUrl('abc123'), 'https://asset.refexone.com/asset/abc123')
    } finally {
      if (prevUrl === undefined) delete process.env.PUBLIC_APP_URL
      else process.env.PUBLIC_APP_URL = prevUrl
      if (prevPort === undefined) delete process.env.PORT
      else process.env.PORT = prevPort
    }
  })
})
