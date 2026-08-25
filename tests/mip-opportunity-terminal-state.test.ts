import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP opportunity terminal state', () => {
  it('keeps owner lifecycle actions behind the server-projected edit capability', () => {
    const detailView = source('src/packages/member/mip-opportunities/detail/index.wxml')
    const editorPage = source('src/packages/member/mip-opportunities/editor/index.ts')

    expect(detailView).toContain('wx:if="{{item.canEdit}}"')
    expect(editorPage).toContain('if (detail && !detail.canEdit)')
    expect(editorPage).toContain('机会已结束，不能继续编辑。')
  })
})
