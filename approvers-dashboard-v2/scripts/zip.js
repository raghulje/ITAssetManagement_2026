import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import archiver from 'archiver'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const distPath = path.resolve(__dirname, '../dist')

const data = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')
const { name: packageName } = JSON.parse(data)
const zipFilePath = path.resolve(__dirname, `../${packageName}.zip`)

if (fs.existsSync(zipFilePath)) {
    fs.unlinkSync(zipFilePath)
}

function removeDirSafe(targetPath, phase) {
    if (!fs.existsSync(targetPath)) return
    try {
        fs.rmSync(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 6,
            retryDelay: 200,
        })
    } catch (err) {
        // On Windows, antivirus/indexers/dev servers may briefly lock files.
        // We should not fail zip creation just because cleanup is blocked.
        if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
            console.warn(`[zip] Skipping ${phase} cleanup: ${err.code} on ${targetPath}`)
            return
        }
        throw err
    }
}
removeDirSafe(distPath, 'pre-build')

function buildProject() {
    execSync('npm run build', { stdio: 'inherit' }) // using 'npm' instead of other package managers, because npm is a safe bet
    // and will exists on everyone's machine if they have node.js installed.
}

async function zipDistFolder() {
    const output = fs.createWriteStream(zipFilePath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => {})

    archive.on('error', (err) => {
        throw err
    })

    archive.pipe(output)
    archive.directory(distPath, false)
    await archive.finalize()
}

buildProject()
await zipDistFolder()

removeDirSafe(distPath, 'post-zip')
