import { now, run } from '../db/index.js'
import { ensureP2pAssetColumns } from './p2pColumns.js'

/** Remember the IT Asset Manager who first registered or submitted the field capture. */
export async function stampRegisteredBy(assetId: number, userId: number | null | undefined) {
  const id = Number(userId)
  if (!assetId || !Number.isFinite(id) || id <= 0) return
  await ensureP2pAssetColumns()
  const ts = now()
  await run(`
    UPDATE assets
    SET registered_by = COALESCE(registered_by, ?),
        registered_at = COALESCE(registered_at, ?),
        created_by = COALESCE(created_by, ?),
        updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `, [id, ts, id, ts, assetId])
}
