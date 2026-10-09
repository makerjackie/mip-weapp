/** Read-only byte comparison at the configured public admin origin. */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadCaseEnv } from './lib/example-cloudbase.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const mimeByExtension = { '.html': /text\/html/, '.js': /(?:javascript|ecmascript)/, '.css': /text\/css/, '.png': /image\/png/, '.jpg': /image\/jpeg/, '.jpeg': /image\/jpeg/, '.webp': /image\/webp/, '.svg': /image\/svg\+xml/ }

export function validateManifest(manifest) {
  assert.equal(manifest?.prefix, 'mip-admin-console/', 'Unexpected hosting prefix')
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'Manifest files required')
  const seen = new Set()
  for (const file of manifest.files) {
    assert.equal(typeof file.path, 'string')
    assert.ok(!file.path.startsWith('/') && !file.path.includes('\\') && !/[?#:%]/.test(file.path) && [...file.path].every(character => character.codePointAt(0) >= 32), 'Invalid asset path')
    assert.ok(file.path.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.')), 'Unsafe asset path')
    assert.ok(!/\.(?:map|pem|key)$/i.test(file.path) && !['_headers', '_redirects', '_worker.js', '_routes.json'].includes(path.posix.basename(file.path)), 'Private or platform metadata asset')
    assert.ok(!seen.has(file.path), 'Duplicate asset path')
    seen.add(file.path)
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0, 'Invalid asset size')
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
  }
  assert.ok(seen.has('index.html'), 'Manifest index.html required')
  return manifest.files
}

export async function verifyLiveAssets({ origin, manifest, fetchImpl = fetch }) {
  const files = validateManifest(manifest)
  const checked = []
  let entry
  for (const file of files) {
    const resource = file.path === 'index.html' ? '/' : `/${file.path}`
    const response = await fetchImpl(`${origin}${resource}`, { redirect: 'error', signal: AbortSignal.timeout(45000) })
    assert.equal(response.status, 200, `HTTP mismatch: ${resource}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(bytes.length, file.bytes, `Size mismatch: ${resource}`)
    assert.equal(hash(bytes), file.sha256, `SHA-256 mismatch: ${resource}`)
    const expectedMime = mimeByExtension[path.posix.extname(file.path)]
    if (expectedMime) {
      assert.match(response.headers.get('content-type') || '', expectedMime, `MIME mismatch: ${resource}`)
    }
    if (file.path === 'index.html') {
      const scripts = [...bytes.toString('utf8').matchAll(/<script\s[^>]+>/gi)].map(([tag]) => tag.match(/\ssrc=["']([^"']+\.js)["']/i)?.[1]).filter(Boolean)
      assert.equal(scripts.length, 1, 'Expected one frontend entry script')
      entry = scripts[0]
      assert.ok(entry.startsWith('/assets/') && files.some(candidate => `/${candidate.path}` === entry), 'Entry script not in manifest')
    }
    checked.push({ path: resource, bytes: bytes.length, sha256: file.sha256, matched: true })
  }
  return { generatedAt: new Date().toISOString(), staticAssetsVerified: true, filesMatched: checked.length, entry, files: checked, scope: 'Public static bytes only; function source, authentication and browser acceptance require separate evidence.' }
}

function requireLocalReport(root, output) {
  const target = path.resolve(root, output)
  assert.ok(target.startsWith(`${path.join(root, '.tmp')}${path.sep}`), 'Write reports only under repository .tmp/')
  let directory = path.dirname(target)
  while (directory !== root) {
    if (fs.existsSync(directory)) {
      assert.ok(!fs.lstatSync(directory).isSymbolicLink(), 'Report path contains a symbolic link')
    }
    directory = path.dirname(directory)
  }
  if (fs.existsSync(target)) {
    assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink(), 'Report target must be a regular file')
  }
  return target
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('verify-admin-live-assets.mjs --origin=<configured HTTPS origin> --manifest=<static deployment manifest> --output=.tmp/<release>/assets.public.json')
    return
  }
  assert.ok(args.every(arg => /^--(?:origin|manifest|output)=.+$/.test(arg)), 'Use only origin, manifest and output arguments')
  const values = Object.fromEntries(args.map((arg) => {
    const i = arg.indexOf('=')
    return [arg.slice(2, i), arg.slice(i + 1)]
  }))
  assert.equal(Object.keys(values).length, args.length, 'Duplicate arguments')
  assert.ok(values.origin && values.manifest && values.output, 'origin, manifest and output are required')
  const root = path.resolve(import.meta.dirname, '..')
  const env = loadCaseEnv(root)
  const target = new URL(values.origin)
  assert.ok(target.protocol === 'https:' && target.origin === values.origin, 'Exact HTTPS origin required')
  assert.equal(values.origin, env.MIP_ADMIN_WEB_CLOUDBASE_ORIGIN, 'Origin differs from configured CloudBase admin target')
  const output = requireLocalReport(root, values.output)
  const report = await verifyLiveAssets({ origin: values.origin, manifest: JSON.parse(fs.readFileSync(path.resolve(root, values.manifest), 'utf8')) })
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ staticAssetsVerified: true, filesMatched: report.filesMatched, entry: report.entry, report: path.relative(root, output) }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
