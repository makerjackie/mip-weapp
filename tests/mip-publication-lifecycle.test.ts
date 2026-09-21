import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP member publication lifecycle', () => {
  it('exposes explicit cooperation card and super case unpublish actions', () => {
    const server = source('cloudfunctions/mip-opportunities-api/index.js')
    const cooperationClient = source('src/modules/mip-cooperation/client.ts')
    const caseClient = source('src/modules/mip-cases/client.ts')
    const cooperationPage = source('src/packages/member/mip-cooperation/detail/index.ts')
    const casePage = source('src/packages/member/mip-cases/detail/index.ts')

    expect(server).toContain('\'unpublishCooperationCard\'')
    expect(server).toContain('\'unpublishSuperCase\'')
    expect(cooperationClient).toContain('\'unpublishCooperationCard\'')
    expect(caseClient).toContain('\'unpublishSuperCase\'')
    expect(cooperationPage).toContain('cooperationModule.unpublish(item.id, item.version)')
    expect(casePage).toContain('superCaseModule.unpublish(item.id, item.version)')
  })

  it('keeps unpublish separate from irreversible member-side deletion', () => {
    const cooperationDomain = source('cloudfunctions/mip-opportunities-api/domain/cooperation.js')
    const caseDomain = source('cloudfunctions/mip-opportunities-api/domain/cases.js')
    const detailTemplates = [
      source('src/packages/member/mip-cooperation/detail/index.wxml'),
      source('src/packages/member/mip-cases/detail/index.wxml'),
    ].join('\n')
    const listTemplates = [
      source('src/packages/member/mip-cooperation/list/index.wxml'),
      source('src/packages/member/mip-cases/list/index.wxml'),
    ].join('\n')
    const listPages = [
      source('src/packages/member/mip-cooperation/list/index.ts'),
      source('src/packages/member/mip-cases/list/index.ts'),
    ].join('\n')

    expect(cooperationDomain).toContain('SET status = \'UNPUBLISHED\', version = version + 1')
    expect(caseDomain).toContain('SET status = \'UNPUBLISHED\', version = version + 1')
    expect(caseDomain).not.toMatch(/DELETE FROM mip_super_cases/)
    expect(cooperationDomain).not.toMatch(/DELETE FROM mip_cooperation_cards/)
    expect(detailTemplates).toContain('下架合作卡')
    expect(detailTemplates).toContain('下架案例')
    expect(detailTemplates).toContain('删除合作卡')
    expect(detailTemplates).toContain('删除案例')
    // journey-review C5（2026-09-21 拍板）：列表删除入口收敛为长按卡片 500ms +
    // 微信原生确认弹窗（删除警示红）→ 卡片移除 + toast「已删除」（1.8s），按钮行移除。
    expect(listTemplates).toContain('bind:longpress="deleteCard"')
    expect(listTemplates).toContain('bind:longpress="deleteCase"')
    expect(listTemplates).not.toContain('catch:tap="deleteCard"')
    expect(listTemplates).not.toContain('catch:tap="deleteCase"')
    expect(listTemplates).not.toContain('管理案例')
    expect(listPages).toContain('删除后将无法恢复，是否删除？')
    expect(listPages).toContain('confirmColor: \'#FF4D5E\'')
    expect(listPages).toContain('duration: 1800')
  })

  it('keeps an unpublished owner resource editable so it is not a terminal dead end', () => {
    const cooperationDomain = source('cloudfunctions/mip-opportunities-api/domain/cooperation.js')
    const caseDomain = source('cloudfunctions/mip-opportunities-api/domain/cases.js')
    for (const domain of [cooperationDomain, caseDomain]) {
      expect(domain).toContain('canEdit: mine')
      expect(domain).toContain('[\'PUBLISHED\', \'UNPUBLISHED\'].includes(existing?.status)')
      expect(domain).not.toContain('existing.status === \'UNPUBLISHED\') throw new Error(\'FORBIDDEN\')')
    }
  })
})
