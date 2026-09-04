import type { AtRule, Root, Rule } from 'postcss'

import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function declarations(rule: Rule) {
  return Object.fromEntries(
    rule.nodes
      .filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value]),
  )
}

function rule(root: Root | AtRule, selector: string, topLevel = false) {
  const matches: Rule[] = []
  if (topLevel) {
    for (const candidate of root.nodes || []) {
      if (candidate.type === 'rule' && candidate.selectors.includes(selector)) {
        matches.push(candidate)
      }
    }
  }
  else {
    root.walkRules((candidate) => {
      if (candidate.selectors.includes(selector)) {
        matches.push(candidate)
      }
    })
  }
  expect(matches).toHaveLength(1)
  return matches[0]
}

function media(root: Root, params: string) {
  const matches = root.nodes.filter(
    (node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params === params,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

describe('MIP event participant visual hierarchy', () => {
  const template = source('src/packages/member/mip-events/participants/index.wxml')
  const page = source('src/packages/member/mip-events/participants/index.ts')
  const stylesheet = postcss.parse(source('src/packages/member/mip-events/participants/index.wxss'))

  it('keeps server-backed search, filters, profile routes, and privacy fallbacks', () => {
    expect(page).toContain('mipEventsModule.listPublicParticipants')
    expect(page).toContain('mipEventsModule.listHeartCandidates')
    expect(page).toContain('mipEventsModule.getHeart')
    expect(page).toContain('caseNavigateTo')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
    expect(page).toContain('displayName: participant.nickname || \'未公开姓名\'')
    expect(page).toContain('viewMode=SENT')
    expect(page).not.toMatch(/wx\.cloud|openid|phoneNumber/)

    expect(template).toContain('bindconfirm="onSearchConfirm"')
    expect(template).toContain('data-kind="GUEST"')
    expect(template).toContain('data-kind="PLAYER"')
    expect(template).toContain('data-view="SENT"')
    expect(template).toContain('data-view="RECEIVED"')
    expect(template).toContain('bind:tap="changeView"')
    expect(template).toContain('data-profile-ref="{{item.profileRef}}"')
    expect(template).not.toMatch(/邀请人|Lv\.|参与人数/)
  })

  it('preserves public states and separates restricted heart access from retryable errors', () => {
    expect(template).toContain('state === \'loading\'')
    expect(template).toContain('state === \'error\'')
    expect(template).toContain('heartState === \'restricted\'')
    expect(template).toContain('heartState === \'error\'')
    expect(template).toContain('title="心动功能暂不可用"')
    expect(template).toContain('本场签到后可查看和使用心动功能。')
    expect(template).toContain('title="暂时无法加载心动信息"')
    expect(template).toContain('action-text="重新加载"')
    expect(template).toContain('bind:action="loadParticipants"')
    expect(template).toContain('bind:action="retryHeartState"')
    expect(template).toContain('loading="{{loadingMore}}"')
    expect(template).toContain('<app-page-exit />')
  })

  it('shows private counts and explicit caller-relative heart relations on cards', () => {
    expect(template).toContain('{{sentItems.length}}')
    expect(template).toContain('{{receivedItems.length}}')
    expect(template).toContain('{{sentItems.length ? \'修改或取消心动\' : \'选择心动\'}}')
    expect(template).toContain('item.heartRelation === \'SENT\' || item.heartRelation === \'MUTUAL\'')
    expect(template).toContain('item.heartRelation === \'RECEIVED\' || item.heartRelation === \'MUTUAL\'')
    expect(template).toContain('心动信息仅本人可见')
    expect(declarations(rule(stylesheet, '.participant-card__relations', true))).toMatchObject({
      'display': 'flex',
      'flex-wrap': 'wrap',
    })
  })

  it('uses compact visual pills without shrinking their phone hit targets', () => {
    expect(declarations(rule(stylesheet, '.participants-filter-target', true))).toMatchObject({
      'display': 'flex',
      'min-height': '88rpx',
    })
    expect(declarations(rule(stylesheet, '.participants-filter-pill', true))).toMatchObject({
      'min-height': '56rpx',
      'border-radius': '12rpx',
    })
    expect(template).toContain('participants-filter-pill--active')
    expect(template).toContain('name="check"')
  })

  it('scales the participant grid from two to three to four columns', () => {
    expect(declarations(rule(stylesheet, '.participants-grid', true))).toMatchObject({
      'display': 'grid',
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
    })
    expect(declarations(rule(media(stylesheet, '(min-width: 600px) and (max-width: 959px)'), '.participants-grid'))).toMatchObject({
      'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    })
    expect(declarations(rule(media(stylesheet, '(min-width: 960px)'), '.participants-grid'))).toMatchObject({
      'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
    })
  })

  it('separates identity, public metadata, and summary without overflowing cards', () => {
    expect(template).toContain('participant-card__name')
    expect(template).toContain('participant-card__meta')
    expect(template).toContain('participant-card__summary')
    expect(template).toContain('aria-label="查看{{item.displayName}}的公开档案"')
    expect(declarations(rule(stylesheet, '.participant-card', true))).toMatchObject({
      'min-width': '0',
      'overflow': 'hidden',
    })
    const textRule = stylesheet.nodes.find(
      (candidate): candidate is Rule => candidate.type === 'rule'
        && candidate.selectors.length === 3
        && candidate.selectors.includes('.participant-card__name')
        && candidate.selectors.includes('.participant-card__meta')
        && candidate.selectors.includes('.participant-card__summary'),
    )
    expect(textRule).toBeDefined()
    expect(declarations(textRule!)).toMatchObject({
      'overflow': 'hidden',
      'text-overflow': 'ellipsis',
      'overflow-wrap': 'anywhere',
    })
  })
})
