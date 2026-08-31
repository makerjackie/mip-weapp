import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function wxmlFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return wxmlFiles(absolute)
    }
    return entry.isFile() && entry.name.endsWith('.wxml') ? [absolute] : []
  })
}

describe('MIP dark theme contrast', () => {
  it('uses dark text on yellow surfaces and avoids white text on danger fills', () => {
    for (const file of wxmlFiles(path.join(root, 'src'))) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/bg-(?:brand|accent|coral|gold)[^"']*text-white/)
      expect(source, file).not.toMatch(/bg-danger[^"']*text-white/)
    }
  })

  it('keeps disabled text readable on dark panels', () => {
    const source = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8')
    expect(source).toContain('--td-text-color-disabled: #999;')
    expect(source).not.toContain('--td-text-color-disabled: #777;')
  })

  it('pins TDesign primary button surfaces to the MIP palette', () => {
    const source = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8')

    expect(source).toContain('@theme static {')
    expect(source).toContain('--td-button-primary-bg-color: #fcdf03;')
    expect(source).toContain('--td-button-primary-border-color: #fcdf03;')
    expect(source).toContain('--td-button-primary-outline-color: #fcdf03;')
    expect(source).toContain('--td-button-primary-outline-border-color: #fcdf03;')
  })
})
