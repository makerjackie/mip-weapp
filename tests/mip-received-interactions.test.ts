import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseProfileInfluence } from '../src/modules/mip-opportunities/validation'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP received interaction client flow', () => {
  it('keeps one reachable influence page with outbound interests, visitors and identity access', () => {
    const page = read('src/packages/member/mip-received/index.ts')
    const view = read('src/packages/member/mip-received/index.wxml')
    const pageConfig = JSON.parse(read('src/packages/member/mip-received/index.json'))
    const profilePage = read('src/pages/profile/index.ts')
    const profile = read('src/pages/profile/index.wxml')

    expect(page).toContain('action: \'INTERACT\'')
    expect(page).toContain('[\'REFERRAL\', \'PROFILE_INTEREST\', \'OUTBOUND_INTEREST\', \'VISITOR\']')
    expect(page).toContain('[\'GUEST\', \'INTERACTION\', \'ACTIVE_INTEREST\', \'VISITOR\']')
    expect(page).toContain('opportunityModule.listReceived(')
    expect(page).toContain('markReceivedRead')
    expect(page).toContain('mipMessagingModule.invalidate()')
    expect(page).not.toContain('wx.cloud')
    expect(view).toContain('引荐给我的')
    expect(view).toContain('对我感兴趣')
    expect(view).toContain('我感兴趣的')
    expect(view).toContain('访客')
    expect(view).toContain('主页总浏览量')
    expect(view).toContain('{{totalViewCount}}')
    expect(view).toContain('state === \'loading\'')
    expect(view).toContain('state === \'empty\'')
    expect(view).toContain('state === \'error\'')
    expect(pageConfig.navigationBarTitleText).toBe('影响力数据')
    expect(profile).toContain('bind:tap=\"openReceivedInteractions\"')
    expect(profile).toContain('visitorUnreadCount > 0')
    expect(profilePage).toContain('opportunityModule.listReceived(\'VISITOR\')')
    expect(profilePage).toContain('Promise.allSettled([')
    expect(profilePage).toContain('summaryResult.status === \'fulfilled\'')
    expect(profilePage).toContain('visitorResult.status === \'fulfilled\'')
    for (const field of ['guestCount', 'interactionCount', 'interestCount', 'visitorCount']) {
      expect(profilePage).toContain(`${field}: null`)
      expect(profilePage).not.toContain(`${field}: 0`)
    }
  })

  it('binds the four influence figures to server facts and their real lists', () => {
    const profilePage = read('src/pages/profile/index.ts')
    const profileView = read('src/pages/profile/index.wxml')
    const publicPage = read('src/packages/member/mip-public-profile/index.ts')
    const publicView = read('src/packages/member/mip-public-profile/index.wxml')
    const profileEditor = read('src/packages/member/mip-profile/index.wxml')
    const server = read('cloudfunctions/mip-opportunities-api/domain/profile-influence.js')

    expect(profilePage).toContain('opportunityModule.getProfileInfluence()')
    expect(profilePage).toContain('?scope=influence&category=')
    expect(publicPage).toContain('?scope=influence&category=')
    for (const label of ['嘉宾', '互动', '感兴趣', '访客']) {
      expect(profileView).toContain(label)
      expect(publicView).toContain(label)
    }
    expect(publicView).toContain('influence ? influence.guestCount : \'—\'')
    expect(profileEditor).toContain('visibilityInfluence')
    expect(server).toContain('FROM mip_event_invitation_attributions')
    expect(server).toContain('FROM mip_event_hearts')
    expect(server).toContain('FROM mip_profile_interests')
    expect(server).toContain('FROM mip_profile_visits')
    expect(server).toContain('guest.status = \'ACTIVE\'')
    expect(server).toContain('registration.share_profile = 1')
  })

  it('rejects invented or malformed influence figures at the client boundary', () => {
    expect(parseProfileInfluence({
      guestCount: 1,
      interactionCount: 2,
      interestCount: 3,
      visitorCount: 4,
    })).toEqual({
      guestCount: 1,
      interactionCount: 2,
      interestCount: 3,
      visitorCount: 4,
    })
    expect(() => parseProfileInfluence({
      guestCount: -1,
      interactionCount: 2,
      interestCount: 3,
      visitorCount: 4,
    })).toThrow('人才服务返回了无效响应')
    expect(() => parseProfileInfluence({
      guestCount: 1,
      interactionCount: 2.5,
      interestCount: 3,
      visitorCount: 4,
    })).toThrow('人才服务返回了无效响应')
    expect(() => parseProfileInfluence({
      guestCount: null,
      interactionCount: 2,
      interestCount: 3,
      visitorCount: 4,
    })).toThrow('人才服务返回了无效响应')
  })

  it('declares the page in every active route contract', () => {
    const route = 'packages/member/mip-received/index'
    const app = JSON.parse(read('src/app.json'))
    const project = JSON.parse(read('config/project.json'))
    const runtime = JSON.parse(read('config/runtime-pages.json'))
    const member = app.subPackages.find((item: { root: string }) => item.root === 'packages/member')

    expect(member.pages).toContain('mip-received/index')
    expect(project.routes.some((item: { pathName: string }) => item.pathName === route)).toBe(true)
    expect(runtime.routes.find((item: { path: string }) => item.path === route)).toMatchObject({
      selector: '#mip-received-interactions-page',
      states: expect.arrayContaining(['loading', 'ready', 'empty', 'error', 'access']),
    })
    expect(runtime.routeCount).toBe(runtime.routes.length)
  })

  it('treats received listing as retriable read and read marking as a single-attempt mutation', () => {
    const transport = read('src/modules/mip-opportunities/transport.ts')
    const client = read('src/modules/mip-opportunities/client.ts')
    expect(transport).toContain('\'listReceivedInteractions\'')
    expect(transport).not.toMatch(/readActions[\s\S]*?'markReceivedInteractionRead'/)
    expect(client).toContain('callOpportunityApi<ReceivedInteractionPage>(\'listReceivedInteractions\'')
    expect(client).toContain('callOpportunityApi<{ messageId: string, readAt: string }>(\'markReceivedInteractionRead\'')
  })

  it('keeps outbound targets opaque and navigates through profile refs', () => {
    const types = read('src/modules/mip-opportunities/types.ts')
    const page = read('src/packages/member/mip-received/index.ts')
    const server = read('cloudfunctions/mip-opportunities-api/domain/received-interactions.js')

    expect(types).toContain('\'OUTBOUND_INTEREST\'')
    expect(types).toContain('target: ReceivedInteractionActor')
    expect(types).toContain('totalViewCount?: number')
    expect(page).toContain('item.target.profileRef')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
    expect(server).toContain('i.actor_user_id = ? AND i.status = \'ACTIVE\'')
    expect(server).toContain('mutualBlockFilter(caller.userId, \'target.id\', \'target.app_id\')')
    expect(server).toContain('createProfileRef(')
    expect(server).not.toContain('targetUserId: row.target_user_id')
  })
})
