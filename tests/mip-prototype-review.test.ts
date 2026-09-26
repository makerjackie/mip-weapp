import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, it } from 'vitest'
import { buildReportData } from '../scripts/ui-fidelity/prototype-review/build-report.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7YQAAAAASUVORK5CYII=', 'base64')
const hash = createHash('sha256').update(png).digest('hex')
const temporaryDirectories: string[] = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-review-test-'))
  temporaryDirectories.push(directory)
  fs.writeFileSync(path.join(directory, 'shot.png'), png)
  const manifest = {
    source: { commit: 'source' },
    implementation: { commit: 'implementation' },
    roleProfiles: {},
    steps: Array.from({ length: 43 }, (_, index) => ({
      id: `S${index}`,
      name: 'Example',
      expectedRole: 'player',
      prototype: { path: 'shot.png', capturedAt: '2026-09-26T00:00:00Z' },
      actual: { path: 'shot.png', capturedAt: '2026-09-26T00:00:00Z', source: 'devtools', role: 'player', roleMatches: true, stateMatches: true },
      review: { status: 'pending' },
      additionalImages: [],
    })),
  }
  const manifestPath = path.join(directory, 'manifest.json')
  const write = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  write()
  return { directory, manifest, manifestPath, write }
}
function passingReview() {
  return { status: 'pass', reviewedBy: 'reviewer', reviewedAt: '2026-09-26T01:00:00Z', visualNotes: 'Compared real images', reviewedImageSha256: hash }
}

it('previous user approval remains read-only and never promotes AI status', () => {
  const f = fixture()
  const feedbackPath = path.join(f.directory, 'feedback.json')
  fs.writeFileSync(feedbackPath, JSON.stringify({ feedback: { S0: { status: 'pass', note: 'old approval' }, unknown: { status: 'pass' } } }))
  const result = buildReportData({ manifestPath: f.manifestPath, feedbackPath })
  assert.equal(result.steps[0].review.status, 'pending')
  assert.equal(result.previousFeedback.feedback.S0.status, 'pass')
  assert.equal(result.previousFeedback.feedback.unknown, undefined)
})

it('stale screenshot SHA invalidates a prior visual pass', () => {
  const f = fixture()
  f.manifest.steps[0].review = { ...passingReview(), reviewedImageSha256: 'old-image' }
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.steps[0].review.status, 'pending')
  assert.equal(result.steps[0].actual.stateMatches, null)
})

it('role mismatch and missing proof cannot be visually passed', () => {
  const f = fixture()
  f.manifest.steps[0].review = passingReview()
  f.manifest.steps[1].review = passingReview()
  f.manifest.steps[1].actual.roleMatches = false
  f.manifest.steps[2].review = { ...passingReview(), reviewedImageSha256: '' }
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.steps[0].review.status, 'pass')
  assert.equal(result.steps[1].review.status, 'pending')
  assert.equal(result.steps[2].review.status, 'pending')
  assert.equal(result.summary.passed, 1)
})

it('separate evidence resolves its own relative images and preserves supplements', () => {
  const f = fixture()
  const evidenceDirectory = path.join(f.directory, 'round-two')
  fs.mkdirSync(evidenceDirectory)
  fs.writeFileSync(path.join(evidenceDirectory, 'new.png'), png)
  const evidencePath = path.join(evidenceDirectory, 'evidence.json')
  fs.writeFileSync(evidencePath, JSON.stringify({ steps: { S0: { actual: { path: 'new.png' }, additionalImages: [{ side: 'actual', path: 'new.png', label: 'Bottom' }] } } }))
  const result = buildReportData({ manifestPath: f.manifestPath, evidencePath })
  assert.equal(result.steps[0].actual.image.available, true)
  assert.equal(result.steps[0].additionalImages[0].image.available, true)
  assert.equal('path' in result.steps[0].actual, false)
})

it('rejects missing frames and unknown override IDs', () => {
  const f = fixture()
  const evidencePath = path.join(f.directory, 'bad.json')
  fs.writeFileSync(evidencePath, JSON.stringify({ steps: { unknown: {} } }))
  assert.throws(() => buildReportData({ manifestPath: f.manifestPath, evidencePath }), /未知步骤/)
  f.manifest.steps.pop()
  f.write()
  assert.throws(() => buildReportData({ manifestPath: f.manifestPath }), /43/)
})

it('24 unmatched scenarios remain coverage gaps, not 24 product failures', () => {
  const f = fixture()
  for (const step of f.manifest.steps.slice(0, 24)) {
    step.review = { ...passingReview(), status: 'data-mismatch' }
    step.actual.roleMatches = false
  }
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.summary.scenarioPending, 24)
  assert.equal(result.summary.knownIssues, 0)
  assert.equal(result.steps[0].verification.visual.status, 'reviewed')
  assert.equal(result.steps[0].verification.aiPending, true)
  assert.equal(result.steps[0].verification.device.status, 'unscoped')
  assert.equal(result.steps[0].review.status, 'data-mismatch')
})

it('a visual pass never hides a failed interaction', () => {
  const f = fixture()
  Object.assign(f.manifest.steps[0].review, passingReview(), { interactionStatus: 'failed' })
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.steps[0].verification.visual.status, 'pass')
  assert.equal(result.steps[0].verification.interaction.status, 'failed')
  assert.equal(result.steps[0].verification.hasIssue, true)
  assert.equal(result.summary.knownIssues, 1)
})

it('interaction pass requires a recorded operation and partial evidence stays partial', () => {
  const f = fixture()
  for (const step of f.manifest.steps.slice(0, 3)) {
    Object.assign(step.review, passingReview(), { interactionStatus: 'pass' })
  }
  Object.assign(f.manifest.steps[1].actual, { interactionEvidence: ['Opened details and returned to list'] })
  Object.assign(f.manifest.steps[1].review, { interactionStatus: 'pending' })
  Object.assign(f.manifest.steps[2].review, { interactionNotes: 'Saved and reloaded the updated record' })
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.deepEqual(result.steps.slice(0, 3).map(step => step.verification.interaction.status), ['pending', 'partial', 'pass'])
})

it('only-device-pending needs an explicit scope and completed independent checks', () => {
  const f = fixture()
  for (const step of f.manifest.steps.slice(0, 4)) {
    Object.assign(step.review, passingReview(), { interactionStatus: 'pass', interactionNotes: 'Checked all relevant navigation', deviceStatus: 'pending' })
  }
  Object.assign(f.manifest.steps[0].review, { deviceRequired: true, deviceNotes: 'Verify native phone authorization on a real phone' })
  Object.assign(f.manifest.steps[1].review, { deviceRequired: true })
  Object.assign(f.manifest.steps[2].review, { deviceRequired: true, deviceNotes: 'Verify payment on a real phone', interactionStatus: 'pending' })
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.steps[0].verification.deviceOnly, true)
  assert.equal(result.steps[0].verification.aiPending, false)
  assert.equal(result.steps[1].verification.deviceOnly, false)
  assert.equal(result.steps[2].verification.deviceOnly, false)
  assert.equal(result.steps[3].verification.deviceOnly, false)
  assert.equal(result.steps[3].verification.device.status, 'unscoped')
  assert.equal(result.summary.deviceOnly, 1)
})

it('changed screenshots cannot retain current visual, interaction, or device verification', () => {
  const f = fixture()
  Object.assign(f.manifest.steps[0].review, passingReview(), {
    reviewedImageSha256: 'previous-image',
    interactionStatus: 'pass',
    interactionNotes: 'Previous run passed',
    deviceStatus: 'pass',
    deviceRequired: true,
    deviceNotes: 'Previous device authorization passed',
  })
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.equal(result.steps[0].verification.visual.status, 'pending')
  assert.equal(result.steps[0].verification.interaction.status, 'pending')
  assert.equal(result.steps[0].verification.device.status, 'pending')
  assert.equal(result.steps[0].verification.deviceOnly, false)
})

it('device verification is never inferred from ordinary screenshots or a bare pass flag', () => {
  const f = fixture()
  for (const step of f.manifest.steps.slice(0, 3)) {
    Object.assign(step.review, passingReview(), { deviceStatus: 'pass' })
  }
  Object.assign(f.manifest.steps[1].review, { deviceRequired: false, deviceStatus: 'pending' })
  Object.assign(f.manifest.steps[2].review, { deviceNotes: 'Authorized phone access on an actual iPhone' })
  f.write()
  const result = buildReportData({ manifestPath: f.manifestPath })
  assert.deepEqual(result.steps.slice(0, 3).map(step => step.verification.device.status), ['unscoped', 'not-required', 'pass'])
})
