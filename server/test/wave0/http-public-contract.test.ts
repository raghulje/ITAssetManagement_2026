import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { jsonRequest, startApp, type StartedApp } from './helpers/http.js'

describe('Wave 0 — HTTP contracts (no DB required)', () => {
  let app: StartedApp

  before(async () => {
    app = await startApp()
  })

  after(async () => {
    await app.close()
  })

  it('GET /api/v1/status is public and reports current product contract', async () => {
    const { status, body } = await jsonRequest(app.baseUrl, '/api/v1/status')
    assert.equal(status, 200)
    assert.equal((body as { status: string }).status, 'ok')
    assert.equal((body as { product: string }).product, 'Refex Asset Management')
    const features = (body as { features: string[] }).features
    assert.ok(features.includes('public-qr'))
    assert.ok(features.includes('agent-sync'))
    assert.ok(features.includes('imports'))
  })

  it('protected hardware/location/inventory routes require Bearer (401 Unauthorized)', async () => {
    for (const path of [
      '/api/v1/hardware',
      '/api/v1/locations',
      '/api/v1/consumables',
      '/api/v1/accessories',
      '/api/v1/components',
      '/api/v1/kits',
    ]) {
      const { status, body } = await jsonRequest(app.baseUrl, path)
      assert.equal(status, 401, path)
      assert.deepEqual(body, { status: 'error', messages: ['Unauthorized'], payload: null })
    }
  })

  it('invalid JWT is Unauthorized (does not hit permission catalog)', async () => {
    const { status, body } = await jsonRequest(app.baseUrl, '/api/v1/hardware', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })
    assert.equal(status, 401)
    assert.deepEqual(body, { status: 'error', messages: ['Unauthorized'], payload: null })
  })

  it('POST /api/v1/login without credentials matches current fail message', async () => {
    const { status, body } = await jsonRequest(app.baseUrl, '/api/v1/login', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    assert.equal(status, 400)
    assert.deepEqual(body, {
      status: 'error',
      messages: ['Email and password required'],
      payload: null,
    })
  })

  it('POST /api/v1/agent/register requires AGENT_API_KEY when configured', async () => {
    const prev = process.env.AGENT_API_KEY
    process.env.AGENT_API_KEY = 'wave0-agent-key'
    try {
      const { status, body } = await jsonRequest(app.baseUrl, '/api/v1/agent/register', {
        method: 'POST',
        body: JSON.stringify({ hostname: 'box-1' }),
      })
      assert.equal(status, 401)
      assert.deepEqual(body, {
        status: 'error',
        messages: ['Unauthorized agent'],
        payload: null,
      })
    } finally {
      if (prev === undefined) delete process.env.AGENT_API_KEY
      else process.env.AGENT_API_KEY = prev
    }
  })
})
