import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(absolute)
    }
    return entry.isFile() && /\.ts$/.test(entry.name) ? [absolute] : []
  })
}

describe('platform boundaries', () => {
  it('keeps platform adapters in one top-level namespace', () => {
    const legacyDirectory = path.join(root, 'src/modules/platform')
    expect(fs.existsSync(legacyDirectory) ? fs.readdirSync(legacyDirectory) : []).toEqual([])

    for (const file of sourceFiles(path.join(root, 'src/platform'))) {
      expect(fs.readFileSync(file, 'utf8'), path.relative(root, file)).not.toMatch(
        /(?:^|\/)modules\/mip-/,
      )
    }
  })

  it('keeps the knowledge domain module independent from runtime composition', () => {
    const module = fs.readFileSync(path.join(root, 'src/modules/mip-knowledge/module.ts'), 'utf8')
    expect(module).not.toContain('runtimeConfig')
    expect(module).not.toContain('requireCloudClient')
    expect(module).not.toContain('mipCommerceModule')
    expect(module).not.toMatch(/from ['"].*platform/)
  })
})
