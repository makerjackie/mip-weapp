import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, it } from 'vitest'
import { buildPublicSite } from '../scripts/ui-fidelity/prototype-review/build-public-site.mjs'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })))
function fixture(approved = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-public-review-'))
  directories.push(directory)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7YQAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(path.join(directory, 'shot.png'), png)
  const hash = createHash('sha256').update(png).digest('hex')
  const manifest = {
    source: { commit: 'source', privateToken: 'secret-value' },
    implementation: { commit: 'implementation', environment: 'private-env' },
    roleProfiles: {},
    steps: Array.from({ length: 43 }, (_, i) => ({
      id: `S${i}`,
      name: 'Example',
      expectedRole: 'player',
      prototype: { path: 'shot.png', capturedAt: '2026-09-26' },
      actual: { path: 'shot.png', capturedAt: '2026-09-26', source: 'devtools', roleMatches: true, stateMatches: true, openid: 'private-openid' },
      review: { status: 'pass', reviewedBy: 'reviewer', reviewedAt: '2026-09-26', reviewedImageSha256: hash, visualNotes: '联系电话 13800138000', interactionStatus: 'pending' },
      additionalImages: [],
    })),
  }
  const write = (name: string, value: unknown) => {
    const file = path.join(directory, name)
    fs.writeFileSync(file, JSON.stringify(value))
    return file
  }
  return {
    directory,
    options: {
      manifestPath: write('manifest.json', manifest),
      publicationPath: write('publication.json', { reviewedBy: 'reviewer', reviewedAt: '2026-09-26', approvedImageSha256: approved ? [hash] : [] }),
      outputPath: path.join(directory, 'out'),
    },
    write,
  }
}
it('unapproved screenshots never leave private evidence and visual passes are removed', () => {
  const f = fixture()
  const output = buildPublicSite(f.options)
  assert.equal(output.images, 0)
  assert.equal(output.excluded.length, 86)
  assert.equal(output.summary.passed, 0)
  const html = fs.readFileSync(path.join(f.options.outputPath, 'index.html'), 'utf8')
  for (const secret of ['private-openid', 'private-env', 'secret-value', '13800138000', 'data:image/']) {
    assert.equal(html.includes(secret), false)
  }
})
it('approved assets are deduplicated and simulated results never upgrade UI interactions', () => {
  const f = fixture(true)
  const resultsPath = f.write('results.json', { cases: [{ id: 'role', stepIds: ['S0'], mode: 'simulated-role', status: 'pass', summary: 'Role test', evidence: 'Mock context test passed' }] })
  const output = buildPublicSite({ ...f.options, resultsPath })
  assert.equal(output.images, 1)
  assert.equal(output.cases, 1)
  assert.equal(output.summary.aiPending, 43)
  const html = fs.readFileSync(path.join(f.options.outputPath, 'index.html'), 'utf8')
  assert.equal(html.includes('13800138000'), false)
  assert.equal(html.includes('simulated-role'), true)
  assert.throws(() => buildPublicSite({ ...f.options, resultsPath }), /输出目录必须为空/)
})
it('passing test results without evidence are rejected', () => {
  const f = fixture()
  const resultsPath = f.write('results.json', { cases: [{ id: 'role', stepIds: ['S0'], mode: 'test-account-service', status: 'pass', summary: 'Unsupported' }] })
  assert.throws(() => buildPublicSite({ ...f.options, resultsPath }), /缺少结果说明或证据/)
})
it('simulated screenshots get a separate visual label and can never earn device acceptance', () => {
  const f = fixture(true)
  const manifest = JSON.parse(fs.readFileSync(f.options.manifestPath, 'utf8'))
  manifest.steps[0].actual.source = 'simulated-role'
  manifest.steps[0].review.deviceStatus = 'pass'
  manifest.steps[0].review.deviceRequired = true
  manifest.steps[0].review.deviceNotes = 'Untrusted simulated device claim'
  fs.writeFileSync(f.options.manifestPath, JSON.stringify(manifest))
  const output = buildPublicSite(f.options)
  assert.equal(output.summary.simulationReviewed, 1)
  const html = fs.readFileSync(path.join(f.options.outputPath, 'index.html'), 'utf8')
  const data = JSON.parse(html.match(/const report=(.*);/)![1])
  assert.equal(data.steps[0].verification.visual.status, 'simulated-reviewed')
  assert.equal(data.steps[0].verification.scenario.status, 'simulated')
  assert.equal(data.steps[0].verification.device.status, 'pending')
  assert.equal(data.steps[0].review.status, 'pending')
})
it('role merge keeps stale screenshots pending while preserving all database checks', async () => {
  const { mergeRoleResults } = await import('../scripts/ui-fidelity/prototype-review/merge-role-results.mjs')
  const f = fixture(true)
  fs.mkdirSync(path.join(f.directory, 'actual'))
  fs.copyFileSync(path.join(f.directory, 'shot.png'), path.join(f.directory, 'actual/S0.png'))
  f.write('captures.json', { S0: { state: 'ready', role: 'player', source: 'simulated-role' } })
  f.write('visual-review.json', { S0: { reviewedImageSha256: 'stale', status: 'accepted-difference' } })
  f.write('summary.public.json', { checks: Array.from({ length: 27 }, (_, i) => ({ name: `demo-${i}: check`, status: 'PASS', evidence: 'live-test-db/local-domain' })) })
  f.write('invoke-smoke.public.json', { results: [] })
  const baselineEvidencePath = f.write('baseline.json', { steps: {} })
  const result = mergeRoleResults({ ...f.options, qaDirectory: f.directory, baselineEvidencePath, implementationCommit: 'test' })
  assert.equal(result.pages, 43)
  assert.equal(result.cases, 70)
  assert.equal(result.incomplete.find(item => item.id === 'S0')?.reason, '新图尚未完成SHA绑定视觉复核')
  const results = JSON.parse(fs.readFileSync(path.join(f.directory, 'public-test-results.json'), 'utf8'))
  assert.equal(results.cases.filter(item => item.status === 'pass').length, 27)
  assert.equal(results.cases.at(-1).status, 'pending')
})

it('role merge recognizes authenticated aliases without upgrading mismatched scenarios', async () => {
  const { mergeRoleResults } = await import('../scripts/ui-fidelity/prototype-review/merge-role-results.mjs')
  const f = fixture(true)
  const manifest = JSON.parse(fs.readFileSync(f.options.manifestPath, 'utf8'))
  manifest.steps[0].expectedRole = 'authenticated'
  fs.writeFileSync(f.options.manifestPath, JSON.stringify(manifest))
  fs.mkdirSync(path.join(f.directory, 'actual'))
  fs.copyFileSync(path.join(f.directory, 'shot.png'), path.join(f.directory, 'actual/S0.png'))
  f.write('captures.json', { S0: { state: 'ready', role: 'player' } })
  f.write('visual-review.json', { S0: { ...manifest.steps[0].review, status: 'data-mismatch', visualNotes: 'Wrong target state', differences: [] } })
  f.write('summary.public.json', { checks: [] })
  f.write('invoke-smoke.public.json', { results: [] })
  const baselineEvidencePath = f.write('baseline.json', { steps: {} })
  mergeRoleResults({ ...f.options, qaDirectory: f.directory, baselineEvidencePath, implementationCommit: 'test' })
  const evidence = JSON.parse(fs.readFileSync(path.join(f.directory, 'public-evidence.json'), 'utf8'))
  assert.equal(evidence.steps.S0.actual.roleMatches, true)
  assert.equal(evidence.steps.S0.actual.stateMatches, false)
  const results = JSON.parse(fs.readFileSync(path.join(f.directory, 'public-test-results.json'), 'utf8'))
  assert.equal(results.cases.find(item => item.id === 'visual-S0').status, 'pending')
})

it('role interactions require current screenshot and successful assertions', async () => {
  const { mergeRoleResults } = await import('../scripts/ui-fidelity/prototype-review/merge-role-results.mjs')
  const f = fixture(true)
  const manifest = JSON.parse(fs.readFileSync(f.options.manifestPath, 'utf8'))
  fs.mkdirSync(path.join(f.directory, 'actual'))
  fs.copyFileSync(path.join(f.directory, 'shot.png'), path.join(f.directory, 'actual/S0.png'))
  f.write('captures.json', { S0: { state: 'ready', role: 'player' } })
  f.write('visual-review.json', { S0: { ...manifest.steps[0].review, status: 'accepted-difference', differences: [] } })
  f.write('summary.public.json', { checks: [] })
  f.write('invoke-smoke.public.json', { results: [] })
  const baselineEvidencePath = f.write('baseline.json', { steps: {} })
  const record = { status: 'pass', notes: 'Tab changes list', operations: ['Change tab and check visible data'], capturedAt: new Date().toISOString(), reviewedImageSha256: manifest.steps[0].review.reviewedImageSha256, assertions: [{ name: 'list changed', passed: true }] }
  for (const [suffix, entry, expected] of [
    ['valid', record, 'pass'],
    ['stale', { ...record, reviewedImageSha256: 'old' }, 'pending'],
    ['contradictory', { ...record, assertions: [{ name: 'list changed', passed: false }] }, 'pending'],
  ] as const) {
    f.write('interactions.json', { S0: entry })
    mergeRoleResults({ ...f.options, outputPath: path.join(f.directory, suffix), qaDirectory: f.directory, baselineEvidencePath, implementationCommit: 'test' })
    const evidence = JSON.parse(fs.readFileSync(path.join(f.directory, 'public-evidence.json'), 'utf8'))
    assert.equal(evidence.steps.S0.review.interactionStatus, expected)
  }
})
