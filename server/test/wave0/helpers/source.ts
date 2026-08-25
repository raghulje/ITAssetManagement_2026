import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export function readServerSource(relFromServer: string): string {
  return fs.readFileSync(path.join(serverRoot, relFromServer), 'utf8')
}
