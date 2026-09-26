import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function readJson(path: string) {
  return JSON.parse(read(path))
}

describe('journey-review WS-SETTINGS', () => {
  it('J5-01 renders the account-settings frame groups with real routes and QS placeholders', () => {
    const template = read('src/packages/member/privacy/index.wxml')
    const page = read('src/packages/member/privacy/index.ts')
    const config = readJson('src/packages/member/privacy/index.json')

    expect(config.navigationBarTitleText).toBe('账号设置')
    expect(template).toContain('<mip-section-header title="账号与安全" />')
    expect(template).toContain('<mip-section-header title="协议" />')
    for (const row of ['绑定手机', '隐私设置', '用户使用协议', '隐私政策', '会员服务协议']) {
      expect(template).toContain(`<mip-detail-row label="${row}"`)
    }
    expect(page).toContain('\'/packages/member/bind-phone/index\'')
    expect(page).toContain('\'/packages/member/privacy-settings/index\'')
    expect(page).toContain('\'/packages/member/user-agreement/index\'')
    expect(page).toContain('\'/packages/member/privacy-policy/index\'')
    // 9/22：绑定微信仅 APP 使用，小程序移除；会员协议读取管理员配置。
    expect(template).not.toContain('label="绑定微信"')
    expect(page).not.toContain('openBindWechat')
    expect(page).not.toContain('功能建设中')
    expect(page).toContain('/packages/member/user-agreement/index?document=membership')
    // 既有区块保留在协议组之下，且设计还原 fixture 分支已被真实路由取代。
    expect(template).toContain('bind:tap="openVisibilitySettings"')
    expect(template).toContain('bind:tap="openBlockedProfiles"')
    expect(template).toContain('bind:tap="openNotificationSettings"')
    expect(page).not.toContain('figmaPanel')
    expect(page).not.toContain('figmaLayout')
  })

  it('J5-02 binds the phone page to the wechat quick-verify rebind path with the login-sheet subtitle variant', () => {
    const template = read('src/packages/member/bind-phone/index.wxml')
    const page = read('src/packages/member/bind-phone/index.ts')
    const config = readJson('src/packages/member/bind-phone/index.json')

    expect(config.navigationBarTitleText).toBe('绑定手机')
    expect(template).toContain('当前手机号')
    expect(template).toContain('{{currentPhoneMasked || \'未绑定\'}}')
    expect(template).toContain('换绑新手机号')
    expect(template).toContain('placeholder="请输入新的手机号"')
    expect(template).toContain('maxlength="11"')
    expect(template).toContain('微信一键获取')
    expect(template).toContain('placeholder="请输入短信验证码"')
    expect(template).toContain('maxlength="6"')
    expect(template).toContain('获取验证码')
    expect(template).toContain('s后重发')
    expect(template).toContain('确认换绑')
    expect(template).toContain('手机号用于登录与接收活动通知。')
    // 授权弹层复用 mip-login-sheet 的 subtitle 变体，不在页面内自绘。
    expect(template).toContain('<mip-login-sheet')
    expect(template).toContain('subtitle="{{loginSheetSubtitle}}"')
    expect(config.usingComponents['mip-login-sheet']).toBe('/components/mip-login-sheet/index')
    // 换绑弹层副标题逐字（\n 换行由 login-sheet 的 pre-line 渲染）。
    expect(page).toContain(
      '\'将获取你微信绑定的手机号，用于换绑确认\\n换绑成功后，新手机号替代原手机号用于登录与通知\'',
    )
    // 路径 A：code 换绑走身份域模块，结果由服务端决定；成功 toast + 返回账号设置。
    expect(page).toContain('mipIdentityModule.rebindWechatPhone(code)')
    expect(page).toContain('title: \'换绑成功\', icon: \'success\'')
    expect(page).toContain('leaveSecondaryPage(\'/pages/profile/index\')')
    // 路径 B：服务端短信发送和一次性校验，提交中阻止重复请求。
    expect(page).toContain('mipIdentityModule.requestPhoneSms(phone)')
    expect(page).toContain('mipIdentityModule.rebindSmsPhone(')
    expect(page).toContain('this.startCountdown(result.retryAfterSeconds)')
    expect(page).toContain('const PHONE_PATTERN = /^1\\d{10}$/')
    expect(page).toContain('const SMS_CODE_PATTERN = /^\\d{6}$/')
    expect(page).not.toContain('短信验证码暂未开通')
    expect(template).toContain('正在换绑')
    expect(template).toContain('disabled="{{rebinding || loginSheetBusy}}"')
    // 终审拍板（WS-EVENTS 台单 1）：换绑/绑定统一走账号设置入口（本页），
    // mip-profile 编辑页不再保留 getPhoneNumber 授权按钮区块。
    const profileTemplate = read('src/packages/member/mip-profile/index.wxml')
    expect(profileTemplate).not.toContain('getPhoneNumber')
    expect(profileTemplate).not.toContain('联系方式')
  })

  it('J5-03 keeps both privacy switches independent, persisted, and rollback-safe', () => {
    const template = read('src/packages/member/privacy-settings/index.wxml')
    const page = read('src/packages/member/privacy-settings/index.ts')
    const config = readJson('src/packages/member/privacy-settings/index.json')

    expect(config.navigationBarTitleText).toBe('隐私设置')
    expect(template).toContain('不让他人在搜索人才时找到我')
    expect(template).toContain('不让非MIP玩家看到我发布的机会')
    expect(template.match(/<t-switch/g)?.length).toBe(2)
    expect(template).toContain('bind:change="onToggle"')
    expect(page).toContain('mipIdentityModule.saveProfile')
    expect(page).toContain('expectedVersion: profile.version')
    expect(page).not.toContain('wx.setStorageSync')
    expect(page).toContain('visibility: { ...profile.visibility, [field]: !next }')
    expect(template).toContain('disabled="{{saving}}"')
    expect(template).not.toContain('将在后续版本')
  })

  it('J5-04 keeps the user agreement reachable under its full title', () => {
    const config = readJson('src/packages/member/user-agreement/index.json')
    const template = read('src/packages/member/user-agreement/index.wxml')

    expect(config.navigationBarTitleText).toBe('用户使用协议')
    expect(template).toContain('{{agreement.body}}')
    expect(template).not.toContain('figmaLayout')
  })

  it('J6-01/J6-02 apply the C5 longpress deletion to the owner showcase and both management lists', () => {
    const profileView = read('src/packages/member/mip-public-profile/index.wxml')
    const profilePage = read('src/packages/member/mip-public-profile/index.ts')
    const coopList = read('src/packages/member/mip-cooperation/list/index.wxml')
    const caseList = read('src/packages/member/mip-cases/list/index.wxml')

    // 本人档案合作卡 / 超级案例 tab：tap 与 longpress 并存，仅本人态生效。
    expect(profileView).toContain('bind:tap="openCooperationCard" bind:longpress="deleteOwnCooperationCard"')
    expect(profileView).toContain('bind:tap="openSuperCase" bind:longpress="deleteOwnSuperCase"')
    expect(profilePage).toContain('if (!this.data.isSelf || this.data.deletingId)')
    expect(profilePage).toContain('cooperationModule.archive(cardId, detail.version)')
    expect(profilePage).toContain('superCaseModule.archive(caseId, detail.version)')
    // 相关机会 tab 的长按删除已随 J6-03 补齐：与另两 tab 同口径，走机会域 archive 契约。
    expect(profileView).toContain('bind:tap="openOpportunity" bind:longpress="deleteOwnOpportunity"')
    expect(profilePage).toContain('await opportunityModule.remove(item.id, detail.version)')
    // 两个管理页同口径：长按 + 原生弹窗 + toast（1.8s），删除按钮行移除。
    for (const [template, handler] of [
      [coopList, 'deleteCard'],
      [caseList, 'deleteCase'],
    ] as const) {
      expect(template).toContain(`bind:longpress="${handler}"`)
      expect(template).not.toContain(`catch:tap="${handler}"`)
      expect(template).not.toContain('删除案例」</view>')
      expect(template).not.toContain('>删除</view>')
    }
  })

  it('registers the new member routes across the app and runtime contracts', () => {
    const appJson = readJson('src/app.json')
    const memberPages = appJson.subPackages
      .find((item: { root: string }) => item.root === 'packages/member')
      .pages as string[]
    expect(memberPages).toContain('bind-phone/index')
    expect(memberPages).toContain('privacy-settings/index')

    const projectRoutes = readJson('config/project.json').routes as Array<{ pathName: string }>
    expect(projectRoutes.map(route => route.pathName)).toContain('packages/member/bind-phone/index')
    expect(projectRoutes.map(route => route.pathName)).toContain('packages/member/privacy-settings/index')

    const runtime = readJson('config/runtime-pages.json')
    expect(runtime.routeCount).toBe(projectRoutes.length)
    expect(runtime.routeCount).toBe(
      appJson.pages.length + appJson.subPackages.reduce(
        (total: number, item: { pages: string[] }) => total + item.pages.length,
        0,
      ),
    )
  })
})
