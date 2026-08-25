import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(root, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

/**
 * Fail closed: Wave 2 suite must not open live HTTP/DB tests against production.
 * This suite is intentionally non-DB (source + unit helpers).
 */
function assertLiveDbIsNotProduction() {
  if (process.env.WAVE2_LIVE !== '1') return
  const name = String(process.env.DB_NAME || '')
  const allow = process.env.WAVE2_ALLOW_DB === '1'
  const looksTest = /test/i.test(name) || name.endsWith('_test')
  if (!allow && !looksTest) {
    console.error('WAVE2_LIVE=1 refused: DB_NAME must contain "test" or set WAVE2_ALLOW_DB=1')
    process.exit(2)
  }
}

assertLiveDbIsNotProduction()

const files = globSync('test/wave2/**/*.test.ts', { cwd: serverRoot }).map((f) => path.join(serverRoot, f))
if (!files.length) {
  console.error('No Wave 2 tests found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
})

process.exit(result.status ?? 1)
