import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runners = ['run-wave0-tests.mjs', 'run-wave1-tests.mjs', 'run-wave2-tests.mjs', 'run-wave3-tests.mjs']

for (const name of runners) {
  const script = path.join(serverRoot, 'scripts', name)
  console.log(`\n=== ${name} ===\n`)
  const result = spawnSync(process.execPath, [script], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
}

process.exit(0)
