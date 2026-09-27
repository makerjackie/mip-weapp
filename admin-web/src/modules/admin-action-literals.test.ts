import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ADMIN_OPERATION_CONTRACT } from '@mip/admin-contracts'

/**
 * Guards the UI against contract drift: a typo in an action string (for example
 * `mip.admin.announcements.publsh`) only fails at runtime today. Every literal in
 * `src/` must be a real action, or a prefix used for `startsWith` matching.
 */
const ACTION_LITERAL = /mip\.admin\.[A-Za-z][A-Za-z0-9.]*[A-Za-z0-9]/g
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      files.push(...sourceFiles(full))
    }
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

describe('admin action literals', () => {
  it('references only real contract actions or their prefixes', () => {
    const actions = new Set<string>(ADMIN_OPERATION_CONTRACT.operations.map(operation => operation.action))
    const unknown: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(ACTION_LITERAL)) {
        const literal = match[0]
        if (actions.has(literal)) continue
        if ([...actions].some(action => action.startsWith(`${literal}.`))) continue
        unknown.push(`${literal} (${path.relative(sourceRoot, file)})`)
      }
    }
    assert.deepEqual(unknown, [])
  })
})
