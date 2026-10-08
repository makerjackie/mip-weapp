import type { AtRule, Root, Rule } from 'postcss'

import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function stylesheetOf(path: string) {
  return postcss.parse(source(path))
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
    expect(page).toContain('mipEventsModule.setHeart')
    expect(page).toContain('caseNavigateTo')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
    expect(page).toContain('displayName: participant.nickname || \'未公开姓名\'')
    expect(page).not.toMatch(/wx\.cloud|openid|phoneNumber/)
    // journey-review J2-02：互动页已并入参与人列表，不再跳独立 interaction 页。
    expect(page).not.toContain('mip-events/interaction')

    expect(template).toContain('bindconfirm="onSearchConfirm"')
    // journey-review J2-02（figma 1818_17230）：搜索占位逐字「搜索姓名，行业，简介等」。
    expect(template).toContain('placeholder="搜索姓名，行业，简介等"')
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

  it('shows private counts and on-card heart voting with a single red heart per event', () => {
    // MIW-36：徽标计数消费服务端 heartCounts（与详情胶囊同源），不以列表长度重算。
    expect(template).toContain('{{heartMineCount}}')
    expect(template).toContain('{{heartReceivedCount}}')
    // journey-review J2-02：心动票落在卡片右上角，灰描边未投 / 红实心已投，点卡其余区域进档案。
    expect(template).toContain('participant-card__heart')
    expect(template).toContain('catch:tap="toggleHeartVote"')
    expect(template).toContain('heart.target && heart.target.profileRef === item.profileRef')
    // MIW-17 G3：原型已投红心为 record 红 #FF2238（非 danger #FF4D5E）。
    expect(template).toContain('name="heart-filled" size="18px" color="var(--mip-record)"')
    expect(template).toContain('name="heart" size="18px" color="var(--color-muted)"')
    expect(template).toContain('item.heartRelation === \'SENT\' || item.heartRelation === \'MUTUAL\'')
    expect(template).toContain('item.heartRelation === \'RECEIVED\' || item.heartRelation === \'MUTUAL\'')
    // MIW-17：原型（figma 1818_17230）私密 tab 无「心动信息仅本人可见」提示条，不得自行加回。
    expect(template).not.toContain('participants-private-note')
    expect(template).not.toContain('心动信息仅本人可见')
    expect(declarations(rule(stylesheet, '.participant-card__relations', true))).toMatchObject({
      'display': 'flex',
      'flex-wrap': 'wrap',
    })
    expect(declarations(rule(stylesheet, '.participant-card__heart', true))).toMatchObject({
      'position': 'absolute',
      'pointer-events': 'auto',
    })
    // figma 1818_17230：56px 头像带白色描边环——由统一嘉宾卡组件 avatar-ring 承载。
    const ring = declarations(rule(stylesheetOf('src/components/talent-card/index.wxss'), '.mip-talent-card__figure-avatar--ring', true))
    expect(String(ring['border'] || '')).toContain('var(--color-ink)')
  })

  it('uses compact visual pills without shrinking their phone hit targets', () => {
    expect(declarations(rule(stylesheet, '.participants-filter-target', true))).toMatchObject({
      'display': 'flex',
      'min-height': '88rpx',
    })
    expect(declarations(rule(stylesheet, '.participants-filter-pill', true))).toMatchObject({
      'min-height': '56rpx',
      'border-radius': '8rpx',
    })
    expect(template).toContain('participants-filter-pill--active')
    // journey-review J2-02：tab 高亮为黄底黑字（figma 1818_17230），不再叠加 check 图标。
    expect(template).not.toContain('name="check"')
  })

  it('keeps the on-card heart hit target at the page 88rpx standard without negative-offset clipping', () => {
    // review fix：热区用 padding 撑开（图标钉在内容区右上角，18px 视觉尺寸不变），
    // 零偏移锚定，不再用负偏移 + 固定小尺寸被卡片 overflow:hidden 裁掉命中面积。
    const heart = declarations(rule(stylesheet, '.participant-card__heart', true))
    expect(heart).toMatchObject({
      'position': 'absolute',
      'top': '0',
      'right': '0',
      'box-sizing': 'border-box',
      'min-width': '88rpx',
      'min-height': '88rpx',
    })
    expect(heart['padding']).toBe('8rpx 8rpx 44rpx 44rpx')
    expect(heart['width']).toBeUndefined()
    expect(heart['height']).toBeUndefined()
    // 桌面断点对齐本页 48px 触控标准。
    for (const params of ['(min-width: 600px) and (max-width: 959px)', '(min-width: 960px)']) {
      expect(declarations(rule(media(stylesheet, params), '.participant-card__heart'))).toMatchObject({
        'min-width': '48px',
        'min-height': '48px',
      })
    }
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

  it('renders participant cards through the unified talent-card grid shell', () => {
    // MIW-24：参与人卡走统一嘉宾卡组件（grid 壳 + 描边环 + 左对齐正文 + kind 章），
    // 页面只保留 corner 心形票与心动关系行；DTO 无 Lv/邀请人/勋章，不造值。
    // MIW-52：中间固定行换统一三标签（地区MIP | 行业 | 身份状态），metaText 保留作搜索口径。
    const cardShell = postcss.parse(source('src/components/talent-card/index.wxss'))
    expect(template).toContain('<mip-talent-card')
    expect(template).toContain('layout="grid"')
    expect(template).toContain('left-align-body="{{true}}"')
    expect(template).toContain('avatar-ring="{{true}}"')
    expect(template).toContain('lead-label="{{item.kindLabel}}"')
    expect(template).toContain('display-name="{{item.displayName}}"')
    expect(template).toContain('tags="{{item.profileTags}}"')
    expect(template).toContain('supporting-text="{{item.introductionText}}"')
    expect(template).toContain('slot="corner"')
    expect(template).toContain('slot="body"')
    expect(template).toContain('aria-label="查看{{item.displayName}}的公开档案"')
    expect(declarations(rule(cardShell, '.mip-talent-card--grid', true))).toMatchObject({
      'min-width': '0',
      'overflow': 'hidden',
    })
    const leftBody = cardShell.nodes.find(
      (candidate): candidate is Rule => candidate.type === 'rule'
        && candidate.selectors.includes('.mip-talent-card--grid-left .mip-talent-card__figure-tags'),
    )
    expect(leftBody).toBeDefined()
    expect(declarations(rule(stylesheet, '.participants-cell', true))).toMatchObject({
      'min-width': '0',
    })
    expect(declarations(rule(stylesheet, '.participants-cell--pressed .mip-talent-card--grid'))).toMatchObject({
      background: 'var(--color-panel-raised)',
    })
    // 桌面断点继续用 apply-shared 覆盖组件类缩放卡面。
    for (const params of ['(min-width: 600px) and (max-width: 959px)', '(min-width: 960px)']) {
      expect(declarations(rule(media(stylesheet, params), '.participants-cell .mip-talent-card--grid'))).toMatchObject({
        'min-height': '220px',
        'border-radius': '8px',
      })
    }
  })
})
