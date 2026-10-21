import { describe, expect, it } from 'vitest'
import { assertReleaseBuildMarker, assertReleaseSource } from '../scripts/lib/release-provenance.mjs'

const sha = 'a'.repeat(40)
const source = { sha, mainSha: sha, branch: 'main', dirty: false }

describe('release provenance safety', () => {
  it('accepts the committed, synchronized main snapshot', () => {
    expect(assertReleaseSource(source, { channel: 'prod' })).toBe(sha)
  })
  it('rejects dirty, feature-branch, and unsynchronized production sources', () => {
    for (const change of [{ dirty: true }, { branch: 'feature/old' }, { mainSha: 'b'.repeat(40) }]) {
      expect(() => assertReleaseSource({ ...source, ...change }, { channel: 'prod' })).toThrow()
    }
  })
  it('rejects a commit changing during the gate or build', () => {
    expect(() => assertReleaseSource(source, { channel: 'prod', expectedSha: 'b'.repeat(40) })).toThrow(/发生变化/)
  })
  it('refuses a default or stale build marker even when the commit appears elsewhere', () => {
    expect(() => assertReleaseBuildMarker(`comment=${sha};buildSha:\`development\``, sha)).toThrow()
    expect(() => assertReleaseBuildMarker(`buildSha:\`${'b'.repeat(40)}\``, sha)).toThrow()
    expect(() => assertReleaseBuildMarker(`buildSha:\`${sha}\``, sha)).not.toThrow()
    expect(() => assertReleaseBuildMarker(`buildSha:"${sha}"`, sha)).not.toThrow()
  })
  it('rejects a stale engineering version in a release artifact', () => {
    const marker = `buildSha:"${sha}";appVersion:"0.2.0"`
    expect(() => assertReleaseBuildMarker(marker, sha, { version: '1.2.5-test.1021' })).toThrow(/版本号/)
    expect(() => assertReleaseBuildMarker(`buildSha:"${sha}";appVersion:\`1.2.5-test.1021\``, sha, { version: '1.2.5-test.1021' })).not.toThrow()
  })
})
