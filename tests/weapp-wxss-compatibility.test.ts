import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function wxssFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return wxssFiles(absolute)
    }
    return entry.isFile() && entry.name.endsWith('.wxss') ? [absolute] : []
  })
}

describe('WeChat WXSS compatibility', () => {
  it('avoids universal child selectors rejected by the native compiler', () => {
    for (const file of wxssFiles(path.join(root, 'src'))) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/[>+~]\s*\*/)
    }
  })
})
