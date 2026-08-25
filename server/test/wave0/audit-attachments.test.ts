import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readServerSource } from './helpers/source.js'

describe('Wave 0 — Action logs + attachments contracts', () => {
  it('action_logs columns used by logAction today', () => {
    const src = readServerSource('src/services/actionLog.ts')
    assert.match(src, /INSERT INTO action_logs \(/)
    assert.match(src, /user_id, action_type, target_id, target_type, item_id, item_type/)
    assert.match(src, /location_id, note, log_meta, action_date/)
    assert.doesNotMatch(src, /before_json/)
  })

  it('asset lifecycle action_type values currently written', () => {
    const hw = readServerSource('src/routes/hardware.ts')
    const auth = readServerSource('src/routes/auth.ts')
    assert.match(hw, /actionType: 'create'/)
    assert.match(hw, /actionType: 'checkout'/)
    assert.match(hw, /actionType: 'checkin'/)
    assert.match(auth, /actionType: 'login'/)
  })

  it('file objectType map includes hardware → asset (files.ts)', () => {
    const files = readServerSource('src/routes/files.ts')
    assert.match(files, /hardware: 'asset'/)
  })

  it('non-image downloads use authenticated /api/v1/files/:id/download path', () => {
    const files = readServerSource('src/routes/files.ts')
    assert.match(files, /`\/api\/v1\/files\/\$\{r\.id\}\/download`/)
  })
})
