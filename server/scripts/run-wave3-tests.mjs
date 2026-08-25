import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(root, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

function assertLiveDbIsNotProduction() {
  if (process.env.WAVE3_LIVE !== '1') return
  const name = String(process.env.DB_NAME || '')
  const allow = process.env.WAVE3_ALLOW_DB === '1'
  const looksTest = /test/i.test(name) || name.endsWith('_test')
  if (!allow && !looksTest) {
    console.error('WAVE3_LIVE=1 refused: DB_NAME must contain "test" or set WAVE3_ALLOW_DB=1')
    process.exit(2)
  }
}

assertLiveDbIsNotProduction()

const files = globSync('test/wave3/**/*.test.ts', { cwd: serverRoot }).map((f) => path.join(serverRoot, f))
if (!files.length) {
  console.error('No Wave 3 tests found')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
})

process.exit(result.status ?? 1)
