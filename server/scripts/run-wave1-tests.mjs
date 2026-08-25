import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(root, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

/**
 * Fail closed: Wave 1 suite must not open live HTTP/DB tests against production.
 * This suite is intentionally non-DB (unit + source-backed), but we keep the guard for safety.
 */
function assertLiveDbIsNotProduction() {
  if (process.env.WAVE1_LIVE !== '1') return
  const name = String(process.env.DB_NAME || '')
  const allow = process.env.WAVE1_ALLOW_DB === '1'
  const looksTest = /test/i.test(name) || name.endsWith('_test')
  if (!allow && !looksTest) {
    console.error('WAVE1_LIVE=1 refused: DB_NAME must contain "test" or set WAVE1_ALLOW_DB=1')
    process.exit(2)
  }
}

assertLiveDbIsNotProduction()

const files = globSync('test/wave1/**/*.test.ts', { cwd: serverRoot }).map((f) => path.join(serverRoot, f))
if (!files.length) {
  console.error('No Wave 1 tests found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
})

process.exit(result.status ?? 1)

