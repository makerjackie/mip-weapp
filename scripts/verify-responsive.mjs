import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = await mkdtemp(join(tmpdir(), 'mip-admin-responsive-'))
const preview = execFile('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4175'], { cwd: root })
let output = ''
preview.stdout?.on('data', chunk => { output += chunk })
preview.stderr?.on('data', chunk => { output += chunk })

try {
  const started = await waitForPreview()
  if (!started) throw new Error(`preview did not start\n${output}`)
  const viewports = [{ width: 390, height: 844 }, { width: 1280, height: 900 }]
  const results = await Promise.all(viewports.map(viewport => execFileAsync(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking', '--virtual-time-budget=1000',
      `--user-data-dir=${profile}-${viewport.width}`, `--window-size=${viewport.width},${viewport.height}`, '--dump-dom', 'http://127.0.0.1:4175/',
    ], { cwd: root, timeout: 15_000, maxBuffer: 1_000_000 })))
  for (const [index, result] of results.entries()) {
    const viewport = viewports[index]
    if (!result.stdout.includes('data-mip-responsive="pass"')) {
      throw new Error(`${viewport.width}px viewport overflow assertion failed\n${result.stdout.match(/<html[^>]*>/)?.[0] || 'html marker missing'}`)
    }
    console.log(`responsive viewport: ${viewport.width}px assertion passed`)
  }
} finally {
  preview.kill('SIGTERM')
  await once(preview, 'close').catch(() => undefined)
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await execFileAsync('curl', ['-fsS', 'http://127.0.0.1:4175/'], { timeout: 1_000 })
      return true
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  return false
}
