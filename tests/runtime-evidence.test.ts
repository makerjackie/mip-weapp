import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertViewportEvidence,
  createObservedViewportEvidence,
  createPendingViewportEvidence,
  prepareRuntimeEvidenceDirectory,
  resolveRuntimeEvidenceOptions,
} from '../scripts/lib/runtime-evidence.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-runtime-evidence-'))
  roots.push(root)
  return root
}

describe('runtime evidence output', () => {
  it('keeps the legacy default while resolving isolated output below the safe root', () => {
    const root = temporaryRoot()
    expect(resolveRuntimeEvidenceOptions(root).outputDir).toBe(path.join(root, '.tmp/runtime'))
    const isolated = resolveRuntimeEvidenceOptions(root, [
      '--output-dir',
      '.tmp/runtime-evidence/run-mobile',
      '--viewport=mobile-375',
    ])
    expect(isolated).toMatchObject({
      isolated: true,
      outputDir: path.join(root, '.tmp/runtime-evidence/run-mobile'),
      viewportProfile: 'mobile-375',
    })
  })

  it('rejects broad, escaping, duplicate, and unsupported output arguments', () => {
    const root = temporaryRoot()
    expect(() => resolveRuntimeEvidenceOptions(root, ['--output-dir', '.tmp']))
      .toThrow('must be a child of .tmp/runtime-evidence')
    expect(() => resolveRuntimeEvidenceOptions(root, ['--output-dir', '../outside']))
      .toThrow('must be a child of .tmp/runtime-evidence')
    expect(() => resolveRuntimeEvidenceOptions(root, ['--output-dir=a', '--output-dir=b']))
      .toThrow('may only be provided once')
    expect(() => resolveRuntimeEvidenceOptions(root, ['--viewport=tablet']))
      .toThrow('Unsupported runtime viewport profile')
  })

  it('never clears an existing isolated evidence directory', () => {
    const root = temporaryRoot()
    const options = resolveRuntimeEvidenceOptions(root, ['--output-dir=.tmp/runtime-evidence/existing'])
    fs.mkdirSync(options.outputDir, { recursive: true })
    fs.writeFileSync(path.join(options.outputDir, 'report.json'), '{}')
    expect(() => prepareRuntimeEvidenceDirectory(root, options))
      .toThrow('must be new or empty')
    expect(fs.readFileSync(path.join(options.outputDir, 'report.json'), 'utf8')).toBe('{}')
  })

  it('rejects symlink traversal before creating or clearing output', () => {
    const root = temporaryRoot()
    const outside = temporaryRoot()
    fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
    fs.symlinkSync(outside, path.join(root, '.tmp/runtime-evidence'))
    const options = resolveRuntimeEvidenceOptions(root, ['--output-dir=.tmp/runtime-evidence/run'])
    expect(() => prepareRuntimeEvidenceDirectory(root, options)).toThrow('cannot traverse a symbolic link')
  })
})

describe('runtime viewport evidence', () => {
  it('records measured dimensions without claiming an automated resize', () => {
    expect(createPendingViewportEvidence('mobile-375')).toMatchObject({
      automatedResize: false,
      observed: null,
      status: 'not-observed',
    })
    const evidence = createObservedViewportEvidence({
      pixelRatio: 2,
      screenHeight: 900,
      screenWidth: 1200,
      windowHeight: 820,
      windowWidth: 375,
    }, 'mobile-375')
    expect(evidence).toMatchObject({
      automatedResize: false,
      mode: 'manual-required',
      observed: { height: 820, width: 375 },
      profile: 'mobile-375',
      status: 'matched',
    })
    expect(() => assertViewportEvidence(evidence)).not.toThrow()
  })

  it('fails closed when the manually selected viewport misses the target profile', () => {
    const evidence = createObservedViewportEvidence({ windowHeight: 844, windowWidth: 390 }, 'mobile-375')
    expect(evidence.status).toBe('mismatched')
    expect(() => assertViewportEvidence(evidence)).toThrow('does not match mobile-375')
  })
})
