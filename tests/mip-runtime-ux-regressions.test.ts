import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

describe('MIP runtime UX regressions', () => {
  it('keeps opportunity results visible while an ordinary tab return revalidates', () => {
    const script = source('src/pages/opportunities/index.ts')
    const showStart = script.indexOf('  onShow()')
    const showEnd = script.indexOf('\n  async loadCatalogs()', showStart)
    const loadStart = script.indexOf('  async loadContent(')
    const loadEnd = script.indexOf('\n  onReachBottom()', loadStart)
    const show = script.slice(showStart, showEnd)
    const load = script.slice(loadStart, loadEnd)

    expect(script).toContain('OPPORTUNITY_REFRESH_INTERVAL_MS = 30_000')
    expect(show).toContain('loadContent(true, { preserveContent: this.data.state === \'ready\' })')
    expect(load).toContain('reset && !options.preserveContent')
    expect(load).toContain('this.lastSuccessfulRefreshAt = Date.now()')
  })

  it('keeps fallback exits only for stack-root pages while semantic actions stay visible', () => {
    const component = source('src/components/page-exit/index.ts')
    const template = source('src/components/page-exit/index.wxml')
    const opportunityEditor = source('src/packages/member/mip-opportunities/editor/index.wxml')
    const paymentResult = source('src/packages/member/payment-result/index.wxml')

    expect(component).toContain('getCurrentPages().length <= 1')
    expect(component).toContain('this.data.managed || this.data.always')
    expect(component).toContain('ready()')
    expect(component).toContain('visible: false')
    expect(template).toContain('wx:if="{{visible}}"')
    expect(opportunityEditor).toContain('<app-page-exit always label="取消" />')
    expect(paymentResult).toContain('<app-page-exit always label="完成"')
  })

  it('keeps fixed filter actions clear of the final options', () => {
    const opportunities = source('src/pages/opportunities/index.wxml')
    const people = source('src/packages/member/mip-people/index.wxml')

    expect(opportunities).toContain('pb-[280rpx]')
    expect(people).toContain('pb-[calc(env(safe-area-inset-bottom)+260rpx)]')
    expect(people).not.toContain('fixed left-6 bottom-[calc(env(safe-area-inset-bottom)+140rpx)]')
  })
})
