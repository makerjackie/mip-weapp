import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '.tmp/mip-acceptance-site')
const origin = new URL(process.argv[2] || 'https://miptest.01mvp.com')
if (origin.protocol !== 'https:' || origin.hostname !== 'miptest.01mvp.com') {
  throw new Error('Verify the configured acceptance origin only')
}
const files = fs.readdirSync(output, { recursive: true }).filter(name => fs.statSync(path.join(output, name)).isFile() && name !== '_headers')
const queue = [...files]
const verified = []
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const file = queue.shift()
    const response = await fetch(new URL(`/${file}`, origin), { redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${file}`)
    }
    const expected = fs.readFileSync(path.join(output, file))
    const actual = Buffer.from(await response.arrayBuffer())
    if (!actual.equals(expected)) {
      throw new Error(`Public file differs: ${file}`)
    }
    if (/\.(?:png|jpe?g|webp)$/.test(file) && !response.headers.get('content-type')?.startsWith('image/')) {
      throw new Error(`Incorrect image MIME: ${file}`)
    }
    if (file.endsWith('.html') && !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`Incorrect HTML MIME: ${file}`)
    }
    verified.push({ file, bytes: actual.length, sha256: createHash('sha256').update(actual).digest('hex') })
  }
}))
verified.sort((a, b) => a.file.localeCompare(b.file))
const report = { checkedAt: new Date().toISOString(), origin: origin.origin, files: verified, passed: true }
fs.writeFileSync(path.join(root, '.tmp/acceptance-site-https.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log('Public HTTPS bytes verified:', verified.length, 'files')
