import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP cooperation card preview', () => {
  it('labels every radar axis and redraws after the page size changes', () => {
    const detail = read('src/packages/member/mip-cooperation/detail/index.ts')
    expect(detail).toContain('context.fillText(ability.label')
    expect(detail).toContain('onResize()')
    expect(detail).toContain(`context.textBaseline = 'middle'`)
  })

  it('saves a draft before opening the owner-visible detail page', () => {
    const source = read('src/packages/member/mip-cooperation/editor/index.ts')
    const view = read('src/packages/member/mip-cooperation/editor/index.wxml')

    expect(view).toContain('bind:tap="preview"')
    expect(source).toMatch(/preview\(\) \{ void this\.save\(false, 'preview'\) \}/)
    expect(source).toMatch(/destination: 'back' \| 'preview'/)
    expect(source).toContain('/packages/member/mip-cooperation/detail/index?id=')
  })
})
