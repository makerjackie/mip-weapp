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
    // MIW-73：邀请人行改由 talent-card 组件按服务端 inviter 渲染，页面仍不得硬编码
    // Lv 等级字样或「参与人数」统计文案（等级值只走 level-text 绑定）。
    expect(template).not.toMatch(/Lv\.|参与人数/)
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
    // MIW-101：四 tab 卡片右上角恒渲染红心入口（不再以 heartTicket/heartState 作渲染门槛），
    // 点按乐观翻转同帧弹跳；未签到者（无凭证）由 aria 与 toast 就地解释规则。
    expect(template).not.toContain('wx:if="{{item.heartTicket')
    expect(template).toContain('participant-card__heart--pulse')
    expect(template).toContain('签到后可被心动')
    // MIW-17 G3：原型已投红心为 record 红 #FF2238（非 danger #FF4D5E）。
    expect(template).toContain('name="heart-filled" size="18px" color="var(--mip-record)"')
    expect(template).toContain('name="heart" size="18px" color="var(--color-muted)"')
    // MIW-17：原型（figma 1818_17230）私密 tab 无「心动信息仅本人可见」提示条，不得自行加回。
    expect(template).not.toContain('participants-private-note')
    expect(template).not.toContain('心动信息仅本人可见')
    // MIW-73：卡面不再渲染「我的心动/对我心动」关系行（body 插槽移除）——tab 归属已由
    // 筛选胶囊表达，右上红心是唯一投票交互；tab 胶囊文案不受影响。
    expect(template).not.toContain('participant-card__relation')
    expect(template).not.toContain('slot="body"')
    expect(declarations(rule(stylesheet, '.participant-card__heart', true))).toMatchObject({
      'position': 'absolute',
      'pointer-events': 'auto',
    })
    // MIW-101：点选弹跳动画只挂在 pulse 类（heartPulseRef 命中该卡），页面加载不重播。
    expect(stylesheet.toResult().css).toContain('@keyframes participant-heart-pop')
    // figma 1818_17230：56px 头像带白色描边环——由统一嘉宾卡组件 avatar-ring 承载。
    const ring = declarations(rule(stylesheetOf('src/components/talent-card/index.wxss'), '.mip-talent-card__figure-avatar--ring', true))
    expect(String(ring['border'] || '')).toContain('var(--color-ink)')
  })

  it('keeps a cross-tab sent-heart hint answering who I voted for outside the sent tab', () => {
    // MIW-114：被投红心四 tab 随卡渲染（heart.target 同口径），但被投者不在当前列表时
    // （另一身份 tab / 对我心动的未互投者 / 分页之外），恒驻提示行是唯一回答
    // 「我有没有投、投给了谁」的入口；点按直达「我的心动」，已投 tab 内不再重复。
    expect(template).toContain('participants-heart-hint')
    expect(template).toContain('heartState === \'ready\' && heart.target && activeView !== \'SENT\'')
    expect(template).toContain('已心动：{{heart.target.nickname || \'未公开姓名\'}}')
    expect(template).toContain('name="heart-filled" size="14px" color="var(--mip-record)"')
    expect(template).toContain('aria-label="已心动{{heart.target.nickname || \'未公开姓名\'}}，点按查看我的心动"')
    // 整行直达「我的心动」tab（复用 changeView 路由，不新增页面方法）。
    expect(template).toContain('bind:tap="changeView" data-view="SENT"')
    expect(declarations(rule(stylesheet, '.participants-heart-hint', true))).toMatchObject({
      'min-height': '88rpx',
      'background': 'var(--color-brand-soft)',
    })
    // 桌面断点对齐本页 48px 触控标准。
    for (const params of ['(min-width: 600px) and (max-width: 959px)', '(min-width: 960px)']) {
      expect(declarations(rule(media(stylesheet, params), '.participants-heart-hint'))).toMatchObject({
        'min-height': '48px',
      })
    }
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
    // MIW-24：参与人卡走统一嘉宾卡组件（grid 壳 + 描边环 + kind 章），页面只保留 corner 心形票。
    // MIW-52：中间固定行换统一三标签（地区MIP | 行业 | 身份状态）。
    // MIW-73：四 tab 同构——左上 Lv、左下勋章、右下邀请人由服务端公开口径补齐；
    // 三标签居中（不再 left-align-body），竖线用白色（--color-ink）。
    const cardShell = postcss.parse(source('src/components/talent-card/index.wxss'))
    expect(template).toContain('<mip-talent-card')
    expect(template).toContain('layout="grid"')
    expect(template).not.toContain('left-align-body')
    expect(template).toContain('avatar-ring="{{true}}"')
    expect(template).toContain('lead-label="{{item.kindLabel}}"')
    expect(template).toContain('level-text="{{item.levelText}}"')
    expect(template).toContain('display-name="{{item.displayName}}"')
    expect(template).toContain('tags="{{item.profileTags}}"')
    expect(template).toContain('supporting-text="{{item.introductionText}}"')
    expect(template).toContain('medals="{{item.medals}}"')
    expect(template).toContain('inviter-name="{{item.inviterName}}"')
    expect(template).toContain('inviter-avatar-url="{{item.inviterAvatarUrl}}"')
    expect(template).toContain('inviter-kind="{{item.inviterKind}}"')
    expect(template).toContain('slot="corner"')
    expect(template).toContain('aria-label="查看{{item.displayName}}的公开档案"')
    expect(declarations(rule(cardShell, '.mip-talent-card--grid', true))).toMatchObject({
      'min-width': '0',
      'overflow': 'hidden',
    })
    // MIW-73：grid 卡标签行保持居中；竖线白色（--color-ink #fff）。
    expect(declarations(rule(cardShell, '.mip-talent-card__figure-tags', true))).toMatchObject({
      'justify-content': 'center',
    })
    expect(declarations(rule(cardShell, '.mip-talent-card__figure-tag-divider', true))).toMatchObject({
      background: 'var(--color-ink)',
    })
    const leftBody = cardShell.nodes.find(
      (candidate): candidate is Rule => candidate.type === 'rule'
        && candidate.selectors.includes('.mip-talent-card--grid-left .mip-talent-card__figure-tags'),
    )
    // interaction 页仍用左对齐变体，组件壳保留该规则；本页不再消费。
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
