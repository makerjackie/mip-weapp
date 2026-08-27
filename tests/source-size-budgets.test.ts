import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSourceSizeBudgets } from '../scripts/lib/source-size-budgets.mjs'

const root = process.cwd()
const temporaryRoots: string[] = []

function temporaryRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-source-budget-'))
  temporaryRoots.push(directory)
  return directory
}

function writeConfig(directory: string, entries: unknown[]) {
  fs.writeFileSync(path.join(directory, 'budget.json'), JSON.stringify({ schemaVersion: 1, entries }))
  return 'budget.json'
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('source size budgets', () => {
  it('covers the known event and admin hotspots with current line counts', () => {
    const entries = assertSourceSizeBudgets(root).entries
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'cloudfunctions/mip-events-api/domain/event-service.js',
        maxLines: 3400,
      }),
      expect.objectContaining({
        path: 'src/packages/admin/message-campaigns/index.ts',
        maxLines: 1400,
      }),
    ]))
    for (const entry of entries) {
      expect(entry.actualLines).toBeLessThanOrEqual(entry.maxLines)
    }
  })

  it('rejects a budget configuration outside the repository', () => {
    expect(() => assertSourceSizeBudgets(root, '../source-size-budgets.json'))
      .toThrow('inside the repository')
  })

  it('rejects a target path that escapes the configured repository', () => {
    const directory = temporaryRoot()
    const configPath = writeConfig(directory, [{
      path: '../outside.js',
      maxLines: 1,
      reason: 'test escape',
    }])
    expect(() => assertSourceSizeBudgets(directory, configPath))
      .toThrow('escapes the repository')
  })

  it('rejects a target reached through a symbolic link', () => {
    const directory = temporaryRoot()
    const outside = path.join(os.tmpdir(), `mip-source-budget-outside-${Date.now()}.js`)
    fs.writeFileSync(outside, 'export default 1\n')
    try {
      fs.symlinkSync(outside, path.join(directory, 'linked.js'))
      const configPath = writeConfig(directory, [{
        path: 'linked.js',
        maxLines: 1,
        reason: 'test symlink',
      }])
      expect(() => assertSourceSizeBudgets(directory, configPath))
        .toThrow('symlink')
    }
    finally {
      fs.rmSync(outside, { force: true })
    }
  })
})
