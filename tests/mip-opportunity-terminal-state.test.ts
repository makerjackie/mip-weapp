import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP opportunity terminal state', () => {
  it('keeps owner lifecycle actions behind the server-projected edit capability', () => {
    const detailView = source('src/packages/member/mip-opportunities/detail/index.wxml')
    const detailPage = source('src/packages/member/mip-opportunities/detail/index.ts')
    const editorPage = source('src/packages/member/mip-opportunities/editor/index.ts')

    expect(editorPage).toContain('if (detail && !detail.canEdit)')
    expect(editorPage).toContain('机会已结束，不能继续编辑。')
    // journey-review J4-05/J4-06：发布人底部条按 ownerBar 呈现；
    // 招募中/已结束可分享（open-type=share），已下架置灰不可点，未发布草稿仍引导发布。
    expect(detailPage).toContain(`journeyStatusOf(item)`)
    expect(detailPage).toContain(`? 'unpublished'`)
    expect(detailView).toContain('wx:if="{{ownerBar}}" id="opportunity-owner-actions"')
    expect(detailView).toContain(`wx:if="{{ownerBar === 'draft'}}"`)
    expect(detailView).toContain('bind:tap="edit">发布机会</view>')
    expect(detailView).toContain(`wx:elif="{{ownerBar === 'unpublished'}}"`)
    expect(detailView).toContain('aria-disabled="true" disabled>分享机会</button>')
    expect(detailView).toContain(`open-type="share" aria-role="button">分享机会</button>`)
    expect(detailView).not.toContain('机会已结束')
  })

  it('ends a recruiting project from the editor status sheet instead of the detail page', () => {
    const editorView = source('src/packages/member/mip-opportunities/editor/index.wxml')
    const editorPage = source('src/packages/member/mip-opportunities/editor/index.ts')
    const catalog = source('src/modules/mip-opportunities/catalog.ts')

    // QZ2 三态说明文案逐字取自终审稿，由 modules 目录单点维护。
    expect(catalog).toContain('想合作的人将通知你')
    expect(catalog).toContain('不再招募')
    expect(catalog).toContain('仅自己可见')
    expect(editorView).toContain('wx:for="{{projectStatusOptions}}"')
    expect(editorView).toContain('bind:tap="closeStatusSheet">取消')
    expect(editorPage).toContain(`journeyStatusOf(detail)`)
    expect(editorPage).toContain(`? 'ENDED'`)
  })
})
