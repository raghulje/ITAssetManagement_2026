import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importEmployeesFromFile } from '../src/services/employeeImport.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const file = path.resolve(__dirname, '../../Employee_List_30072026.xlsx')
console.log('Importing', file)
const s = await importEmployeesFromFile(file)
console.log({
  total: s.total,
  created: s.created,
  updated: s.updated,
  skipped: s.skipped,
  errSample: s.errors.slice(0, 5),
})
process.exit(0)
