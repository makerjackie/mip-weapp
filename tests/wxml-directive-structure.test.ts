import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function wxmlFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return wxmlFiles(absolute)
    return entry.isFile() && entry.name.endsWith('.wxml') ? [absolute] : []
  })
}

describe('WXML directive structure', () => {
  it('keeps iteration on a parent block when using wx:else or wx:elif', () => {
    for (const file of wxmlFiles(path.join(root, 'src'))) {
      const source = fs.readFileSync(file, 'utf8')
      const tags = source.match(/<[^!][^>]*>/g) || []
      const invalid = tags.filter(tag => /\bwx:for=/.test(tag) && /\bwx:(?:else|elif)\b/.test(tag))
      expect(invalid, path.relative(root, file)).toEqual([])
    }
  })
})
