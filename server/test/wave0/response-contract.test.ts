import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fail, nest, okItem, okList, okMessage } from '../../src/utils/response.js'

type Captured = { statusCode: number; payload: unknown }

function mockRes(): { res: any; cap: Captured } {
  const cap: Captured = { statusCode: 200, payload: undefined }
  const res: any = {
    status(code: number) {
      cap.statusCode = code
      return this
    },
    json(payload: unknown) {
      cap.payload = payload
      return this
    },
  }
  return { res, cap }
}

describe('Wave 0 — API envelope contracts (current production)', () => {
  it('okList returns { total, rows } without a status wrapper', () => {
    const { res, cap } = mockRes()
    okList(res, [{ id: 1 }], 9)
    assert.deepEqual(cap.payload, { total: 9, rows: [{ id: 1 }] })
  })

  it('okItem returns the payload as the JSON body', () => {
    const { res, cap } = mockRes()
    okItem(res, { id: 7, asset_tag: 'X' })
    assert.equal(cap.statusCode, 200)
    assert.deepEqual(cap.payload, { id: 7, asset_tag: 'X' })
  })

  it('okMessage uses status success + messages[] + payload', () => {
    const { res, cap } = mockRes()
    okMessage(res, 'Asset assigned successfully', { id: 1 }, 200)
    assert.deepEqual(cap.payload, {
      status: 'success',
      messages: ['Asset assigned successfully'],
      payload: { id: 1 },
    })
  })

  it('fail uses status error + messages[] (default HTTP 400)', () => {
    const { res, cap } = mockRes()
    fail(res, 'Unauthorized', 401)
    assert.equal(cap.statusCode, 401)
    assert.deepEqual(cap.payload, {
      status: 'error',
      messages: ['Unauthorized'],
      payload: null,
    })
  })

  it('nest returns { id, name, ...extra } or null', () => {
    assert.equal(nest(null, 'x'), null)
    assert.deepEqual(nest(3, 'HQ', { code: 'H' }), { id: 3, name: 'HQ', code: 'H' })
  })
})
