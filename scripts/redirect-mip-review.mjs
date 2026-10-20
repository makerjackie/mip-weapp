import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
if (process.argv[2] !== 'publish') {
  console.log('Use: node scripts/redirect-mip-review.mjs publish (verifies migrated files before redirecting the old Pages project)')
  process.exit(0)
}
const archive = JSON.parse(fs.readFileSync(path.join(root, 'docs/mip/acceptance-site/legacy/20261019/archive.json'), 'utf8'))
const dailyURL = 'https://miptest.01mvp.com/updates/2026-10-19/'
const page = await fetch(dailyURL, { redirect: 'error', signal: AbortSignal.timeout(30000) })
const html = await page.text()
if (!page.ok || !['profile', 'talent', 'events', 'growth', 'role-icons', 'catalog', 'verify'].every(id => html.includes(`id="${id}"`)) || html.includes('查看完整原报告')) {
  throw new Error('Consolidated daily report is not verified')
}
const queue = Object.entries(archive.assets)
const checked = []
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const [file, expected] = queue.shift()
    const response = await fetch(`${dailyURL}assets/${file}`, { redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok || createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex') !== expected) {
      throw new Error(`Migrated target is not verified: ${file}`)
    }
    checked.push(file)
  }
}))
const out = path.join(root, '.tmp/mip-review-redirect')
fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(path.join(root, 'docs/mip/acceptance-site/review-redirects'), out, { recursive: true })
fs.writeFileSync(path.join(root, '.tmp/review-redirect-target-check.json'), `${JSON.stringify({ checkedAt: new Date().toISOString(), dailyURL, dailySha256: createHash('sha256').update(html).digest('hex'), verifiedFiles: checked.sort(), passed: true }, null, 2)}\n`)
console.log('Consolidated daily report and', checked.length, 'original assets verified; redirecting the existing mip-review project.')
const result = spawnSync('pnpm', ['exec', 'wrangler', 'pages', 'deploy', out, '--project-name=mip-review', '--branch=main', '--commit-dirty=true'], { cwd: root, stdio: 'inherit', env: process.env })
if (result.status !== 0) {
  throw new Error('Old-site redirect deployment failed; read back its actual status before retry')
}
