/**
 * Import RIL Asset Couriered List contacts as Battery Degradation issues.
 *
 *   cd server && npx tsx scripts/seed-ril-battery-issues.ts
 *
 * Prefer Settings → Battery Degradation → Run Battery Degradation migration in production.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedRilBatteryIssues } from '../src/services/batterySetup.js'

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') })

seedRilBatteryIssues()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2))
    process.exit(0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
