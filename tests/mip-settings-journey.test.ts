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
    expect(template).toContain('<mip-section-header class="mt-[48rpx]" title="协议" />')
    for (const row of ['绑定手机', '绑定微信', '隐私设置', '用户使用协议', '隐私政策', '会员服务协议']) {
      expect(template).toContain(`<mip-detail-row label="${row}"`)
    }
    expect(page).toContain('\'/packages/member/bind-phone/index\'')
    expect(page).toContain('\'/packages/member/privacy-settings/index\'')
    expect(page).toContain('\'/packages/member/user-agreement/index\'')
    expect(page).toContain('\'/packages/member/privacy-policy/index\'')
    // 绑定微信 / 会员服务协议三级页设计未出（QS）：保留行 + 占位提示。
    expect(page.match(/功能建设中/g)).toHaveLength(2)
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
    // 路径 B：60s 防重发倒计时与输入校验骨架；短信通道未接通前降级提示。
    expect(page).toContain('const SMS_COUNTDOWN_SECONDS = 60')
    expect(page).toContain('const PHONE_PATTERN = /^1\\d{10}$/')
    expect(page).toContain('const SMS_CODE_PATTERN = /^\\d{6}$/')
    expect(page).toContain('短信验证码暂未开通')
    // review 清理：短信通道未接通前不存在换绑中的异步流，rebinding 死状态（含 UI disabled/
    // 「正在换绑」文案）已删除，busy 守卫待通道接入时在 confirmRebind 补。
    expect(page).not.toContain('rebinding')
    expect(template).not.toContain('rebinding')
    expect(template).not.toContain('正在换绑')
    expect(page).toContain('通道接入时在此补 busy 守卫')
    // 错误态保留已输入内容：catch 分支只关弹层与提示，不清空 newPhone / smsCode。
    const catchBlock = page.slice(page.indexOf('mipIdentityModule.rebindWechatPhone(code)'), page.indexOf('startCountdown'))
    const rebindErrorTail = catchBlock.slice(catchBlock.indexOf('catch (error)'))
    expect(rebindErrorTail).not.toContain('newPhone: \'\'')
    expect(rebindErrorTail).not.toContain('smsCode: \'\'')
    expect(rebindErrorTail).toContain('换绑失败，请重试。')
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
    // 一期持久化走本机存储（服务端偏好字段缺口见 shared-change-requests）。
    expect(page).toContain('PRIVACY_SETTINGS_STORAGE_KEY')
    expect(page).toContain('wx.setStorageSync(PRIVACY_SETTINGS_STORAGE_KEY')
    // 帧内均绘为开：默认开（待产品确认）。
    expect(page).toContain('hideFromTalentSearch: true')
    expect(page).toContain('hideOpportunitiesFromNonPlayers: true')
    // review P1：注册期 data 只放默认值，持久化值在 onLoad 重读（行为级测试见
    // privacy-settings-lifecycle.test.ts），否则页面重进回显过期快照。
    expect(page).toContain('onLoad() {\n    this.setData(readPrivacySettings())')
    const dataBlock = page.slice(page.indexOf('data: {'), page.indexOf('onLoad()'))
    expect(dataBlock).not.toContain('readPrivacySettings')
    // 保存失败回滚开关并提示。
    expect(page).toContain('this.setData({ [key]: previous })')
    expect(page).toContain('设置暂未保存，请重试。')
    // 一期无服务端消费方：底部文案只承诺已保存，不承诺列表隐藏效果。
    expect(template).toContain('开关状态已保存，将在后续版本对他人可见范围生效。')
    expect(template).not.toContain('将按开关隐藏你的对应内容')
  })

  it('J5-04 keeps the user agreement reachable under its full title', () => {
    const config = readJson('src/packages/member/user-agreement/index.json')
    const template = read('src/packages/member/user-agreement/index.wxml')

    expect(config.navigationBarTitleText).toBe('用户使用协议')
    // 正文保留仓库正式条款（优于设计稿占位段落），生产不走 fixture 分支。
    expect(template).toMatch(/wx:if="\{\{figmaLayout\}\}"/)
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
    // 相关机会 tab 的长按删除随 J6-03（机会域模块 delete 能力）补齐，先不绑定误删入口。
    expect(profileView).not.toContain('bind:longpress="deleteOwnOpportunity"')
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
