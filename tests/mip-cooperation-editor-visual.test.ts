import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP cooperation card editor per the 2571:34139 mockup', () => {
  const source = read('src/packages/member/mip-cooperation/editor/index.ts')
  const view = read('src/packages/member/mip-cooperation/editor/index.wxml')

  it('taps stars to set each trait score from one to five', () => {
    expect(source).toMatch(/const score = Number\(event\.currentTarget\.dataset\.score\)/)
    expect(source).toMatch(/score < 1 \|\| score > MAX_ABILITY_SCORE/)
    expect(view).toContain('data-score="{{star}}"')
    expect(view).toContain('aria-checked="{{star <= item.score}}"')
    expect(view).toContain('star-favorite-3')
    expect(view).toContain('icon-star-line.png')
  })

  it('adds and removes structured circle and quirk groups with one group floor', () => {
    expect(source).toMatch(/addCircle\(\) \{/)
    expect(source).toContain('group <= 0 || this.data.circles.length <= 1')
    expect(source).toMatch(/addQuirk\(\) \{/)
    expect(source).toContain('group <= 0 || this.data.quirks.length <= 1')
    expect(view).toContain('bind:tap="addCircle"')
    expect(view).toContain('bind:tap="removeCircle"')
    expect(view).toContain('bind:tap="addQuirk"')
    expect(view).toContain('bind:tap="removeQuirk"')
    expect(view).toContain('wx:for-index="groupIndex"')
  })

  it('carries legacy role fields through save without rendering them', () => {
    expect(source).toContain('...this.data.legacyFields')
    expect(source).toMatch(/for \(const key of definition\.legacyFieldKeys\)/)
    expect(view).not.toContain('legacyFields')
    expect(read('src/config/mip-catalogs.ts')).toMatch(/legacyFieldKeys: \['resources', 'target'\]/)
  })

  it('shows per-role trait labels and locks role selection for existing cards', () => {
    expect(source).toMatch(/label: definition\.abilityLabels\[index\] \|\| dimension\.label/)
    expect(source).toMatch(/roleLocked: Boolean\(detail\)/)
    expect(view).toContain('wx:if="{{!roleLocked}}"')
    expect(view).toContain('bind:tap="changeRole"')
  })

  it('keeps the single save capsule and publishes drafts from the detail page instead', () => {
    expect(view).toMatch(/bind:tap="saveCard"[\s\S]*?保存/)
    expect(read('src/packages/member/mip-cooperation/detail/index.wxml')).toMatch(/bind:tap="publish"[\s\S]*?发布合作卡/)
    expect(read('src/packages/member/mip-cooperation/detail/index.ts')).toMatch(/publish: true/)
  })
})
