import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

// ---- 档案互动条行为用共享 mock（模块顶层，vitest 会提升） ----
const profileMocks = vi.hoisted(() => ({
  access: vi.fn(),
  relationship: vi.fn(),
  navigate: vi.fn(),
  showModal: vi.fn(),
}))
vi.mock('../src/modules/mip-community', () => ({
  createCommunityReportIntent: vi.fn(),
  mipCommunityModule: { relationship: profileMocks.relationship, block: vi.fn(), report: vi.fn() },
  reportCategoryOptions: [],
}))
vi.mock('../src/modules/mip-identity', () => ({
  evaluateAccess: (snapshot: { ready: boolean }) => ({ ready: snapshot.ready }),
  mipAccessPageUrl: vi.fn(),
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: { beginProtectedAction: profileMocks.access, peekSnapshot: vi.fn(), consumePendingResume: vi.fn(), resolveProfileCardScene: vi.fn() },
}))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: {
    getPublicProfile: vi.fn(),
    recordProfileVisit: vi.fn(),
    listReceived: vi.fn(),
    markReceivedRead: vi.fn(),
  },
  profileInterestMutations: { mergeServer: vi.fn(), subscribe: vi.fn(), mutate: vi.fn() },
}))
// 合并 ws-settings 后档案页引入卡片归档链（mip-cases/mip-cooperation → transport → 运行时配置），
// 测试环境无 weapp-vite 构建常量，按仓库惯例 mock 两个 facade（仅在长按删除 handler 中调用）。
vi.mock('../src/modules/mip-cases', () => ({ superCaseModule: { get: vi.fn(), archive: vi.fn() } }))
vi.mock('../src/modules/mip-cooperation', () => ({ cooperationModule: { get: vi.fn(), archive: vi.fn() } }))
vi.mock('../src/platform/navigation/client', () => ({ caseNavigateTo: profileMocks.navigate }))
vi.mock('../src/modules/mip-messaging/client', () => ({
  mipMessagingModule: { listInbox: vi.fn(), markAllRead: vi.fn(), markRead: vi.fn(), peekInbox: vi.fn(), invalidate: vi.fn() },
}))
vi.mock('../src/platform/cloudbase/loading-diagnostics', () => ({ recordLoadingFailure: vi.fn(), getLoadingDiagnostics: () => [] }))

describe('journey-review WS-PEOPLE · 档案互动条角色门禁（C1 终审 + J2-04）', () => {
  it('wires every interaction-bar entry to the shared native unlock modal instead of a custom sheet', () => {
    const page = read('src/packages/member/mip-public-profile/index.ts')
    const view = read('src/packages/member/mip-public-profile/index.wxml')

    expect(page).toContain(`import { showIdentityUnlockModal } from '../../../shared/identity-unlock'`)
    // 四个入口（我感兴趣按钮 + 感兴趣名单入口）+ access 兜底路径统一走共享 helper。
    expect(page.match(/showIdentityUnlockModal\(\)/g)?.length).toBeGreaterThanOrEqual(3)
    // pending 未定态不渲染：身份快照 resolve 前嘉宾看不到互动条，避免先见条后消失（review 修复）。
    expect(page).toContain(`type InteractionBarMode = 'pending' | 'active' | 'hidden' | 'locked'`)
    expect(page).toContain(`interactionBar: 'pending' as InteractionBarMode`)
    expect(view).toContain(`wx:if="{{!isSelf && (interactionBar === 'active' || interactionBar === 'locked')}}"`)
    expect(view).toContain('bind:tap="toggleInterest"')
    expect(view).toContain('bind:tap="openInterestList"')
    expect(view).toContain(`{{interestActive ? '已感兴趣' : '我感兴趣'}}`)
    // 底部互动条不再走资料补全跳转（改弹解锁窗）；举报/屏蔽安全流不受影响。
    const stickyBar = view.slice(view.indexOf('<mip-sticky-actions'))
    expect(stickyBar).not.toContain('完成身份信息后继续')
    expect(stickyBar).not.toContain('openAccess')
  })

  it('maps the viewer identity snapshot onto the three-role matrix', () => {
    const page = read('src/packages/member/mip-public-profile/index.ts')

    // 普通用户 = INTERACT 未就绪 → locked；嘉宾 = 就绪且无会员权益 → hidden；玩家 → active。
    expect(page).toContain(`this.setData({ interactionBar: 'locked' })`)
    expect(page).toContain(`snapshot.membership.kind === 'PLAYER' ? 'active' : 'hidden'`)
    expect(page).toContain(`if (this.data.interactionBar === 'locked')`)
  })

  it('keeps 我感兴趣 off the production profile (2026-09-21 拍板：合作表态只在机会详情页)', () => {
    const view = read('src/packages/member/mip-public-profile/index.wxml')
    const production = view.slice(view.indexOf('<block wx:elif="{{profile}}">'))
    expect(production).not.toContain('bind:tap="cooperationIntent"')
    expect(production).toContain('{{item.cooperationCount || 0}} 人想合作')
  })
})

describe('journey-review WS-PEOPLE · 档案互动条行为（J2-03 → J2-04）', () => {
  type ProfilePage = Record<string, unknown> & {
    data: Record<string, unknown>
    setData: (patch: Record<string, unknown>) => void
    toggleInterest: () => void
    openInterestList: () => void
    applyInteractionBarMode: (snapshot: unknown) => void
    pendingAction: string
  }
  let definition: ProfilePage

  beforeAll(async () => {
    vi.stubGlobal('wx', { showToast: vi.fn(), showModal: profileMocks.showModal })
    vi.stubGlobal('Page', (value: ProfilePage) => {
      definition = value
    })
    await import('../src/packages/member/mip-public-profile/index')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    profileMocks.showModal.mockResolvedValue({ confirm: true, cancel: false, errMsg: 'showModal:ok' })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  function page(overrides: Record<string, unknown> = {}) {
    const instance = Object.create(definition) as ProfilePage
    instance.data = { ...structuredClone(definition.data), isSelf: false, ...overrides }
    instance.setData = (patch: Record<string, unknown>) => {
      Object.assign(instance.data, patch)
    }
    return instance
  }

  it('shows the verbatim native unlock modal for a normal user and stays on the page', () => {
    const p = page({ interactionBar: 'locked' })
    p.toggleInterest()
    expect(profileMocks.showModal).toHaveBeenCalledExactlyOnceWith({
      title: '',
      content: '报名并签到任意一场MIP活动，可解锁该功能',
      confirmText: '确定',
      cancelText: '取消',
      showCancel: true,
    })
    expect(profileMocks.navigate).not.toHaveBeenCalled()
    expect(p.data.state).not.toBe('access')
  })

  it('routes the interested-list entry through the same unlock modal for a normal user', () => {
    const p = page({ interactionBar: 'locked' })
    p.openInterestList()
    expect(profileMocks.showModal).toHaveBeenCalledTimes(1)
    expect(profileMocks.navigate).not.toHaveBeenCalled()
  })

  it('keeps the bar functional for players and hidden for guests', () => {
    const p = page()
    p.applyInteractionBarMode({ ready: true, membership: { kind: 'PLAYER' } })
    expect(p.data.interactionBar).toBe('active')
    p.applyInteractionBarMode({ ready: true, membership: { kind: 'GUEST' } })
    expect(p.data.interactionBar).toBe('hidden')
    p.applyInteractionBarMode({ ready: false, membership: { kind: 'GUEST' } })
    expect(p.data.interactionBar).toBe('locked')
    p.applyInteractionBarMode(undefined)
    expect(p.data.interactionBar).toBe('locked')
  })
})

describe('journey-review WS-PEOPLE · 站内信（J3-04b QI 自拟承接）', () => {
  it('renames the page to 站内信 and renders typed rows without emoji icons', () => {
    const config = JSON.parse(read('src/packages/member/mip-notifications/index.json'))
    const view = read('src/packages/member/mip-notifications/index.wxml')
    const page = read('src/packages/member/mip-notifications/index.ts')

    expect(config.navigationBarTitleText).toBe('站内信')
    expect(page).toContain(`PROFILE_INTEREST: { key: 'HEART', label: '心动通知'`)
    expect(page).toContain(`EVENT: { key: 'EVENT', label: '活动提醒'`)
    expect(page).toContain(`SYSTEM: { key: 'SYSTEM', label: '系统通知'`)
    expect(page).toContain(`return inboxRowTypes[messageType as InboxMessageType] || inboxRowTypes.SYSTEM`)
    expect(view).toContain(`{{item.rowType.label}}`)
    expect(view).toContain(`name="{{item.rowType.iconName}}"`)
    expect(view).not.toContain('💛')
    expect(view).not.toContain('📅')
    expect(view).not.toContain('🔔')
    expect(view).toContain(`wx:if="{{!item.readAt}}"`)
    expect(view).not.toContain('bind:tap="markAllRead"')
  })

  it('formats relative time buckets and clears unread dots on entry', async () => {
    const messaging = await import('../src/modules/mip-messaging/client')
    const inbox = messaging.mipMessagingModule as unknown as {
      listInbox: ReturnType<typeof vi.fn>
      markAllRead: ReturnType<typeof vi.fn>
      peekInbox: ReturnType<typeof vi.fn>
    }
    let definition: Record<string, unknown> & {
      data: { items: Array<{ rowType: { label: string }, createdText: string, readAt?: string }>, unreadCount: number }
      setData: (patch: Record<string, unknown>) => void
      enterInbox: () => Promise<void>
    }
    vi.stubGlobal('wx', { stopPullDownRefresh: vi.fn() })
    vi.stubGlobal('Page', (value: typeof definition) => {
      definition = value
    })
    await import('../src/packages/member/mip-notifications/index')
    vi.unstubAllGlobals()

    const now = Date.now()
    inbox.peekInbox.mockReturnValue(undefined)
    inbox.listInbox.mockResolvedValue({
      items: [
        { id: 'm1', messageType: 'PROFILE_INTEREST', title: '心动', body: '大鹅飞飞 对你心动了，快去看看', createdAt: new Date(now - 3 * 60000).toISOString() },
        { id: 'm2', messageType: 'EVENT', title: '活动', body: '你报名的活动「设计户外过两天再说露营地」即将开始', createdAt: new Date(now - 26 * 3600000).toISOString() },
        { id: 'm3', messageType: 'OPERATIONS', title: '系统', body: '欢迎加入 MIP，完善名片让更多伙伴认识你', createdAt: new Date(now - 3 * 86400000).toISOString() },
        // review 补强：相对时间边界——<1 分钟归「刚刚」，无效日期静默为空串（不渲染时间行）。
        { id: 'm4', messageType: 'SYSTEM', title: '系统', body: '刚刚的边界', createdAt: new Date(now - 30 * 1000).toISOString() },
        { id: 'm5', messageType: 'SYSTEM', title: '系统', body: '脏数据', createdAt: 'not-a-date' },
      ],
      unreadCount: 5,
      nextCursor: '',
    })
    inbox.markAllRead.mockResolvedValue({ readAt: '2026-09-22T00:00:00.000Z' })

    const instance = Object.create(definition!) as typeof definition
    instance.data = structuredClone(definition!.data)
    instance.setData = (patch: Record<string, unknown>) => {
      Object.assign(instance.data, patch)
    }
    await instance.enterInbox()

    expect(instance.data.items.map(item => item.rowType.label)).toEqual(['心动通知', '活动提醒', '系统通知', '系统通知', '系统通知'])
    expect(instance.data.items.map(item => item.createdText)).toEqual(['3分钟前', '昨天', '3天前', '刚刚', ''])
    // 进入即清除未读（QI 拍板），行内红点随 readAt 消失。
    expect(inbox.markAllRead).toHaveBeenCalledTimes(1)
    expect(instance.data.unreadCount).toBe(0)
    expect(instance.data.items.every(item => item.readAt)).toBe(true)
  })
})

describe('journey-review WS-PEOPLE · 影响力四列表 + 心动值（J3-05/06/07/08）', () => {
  type ReceivedPage = Record<string, unknown> & {
    data: Record<string, unknown>
    setData: (patch: Record<string, unknown>, callback?: () => void) => void
    onLoad: (query: Record<string, string | undefined>) => void
    changeCategory: (event: { currentTarget: { dataset: Record<string, string> } }) => void
    loadCategory: (category: string, reset: boolean) => Promise<void>
    applySearch: (keyword: string) => void
    checkAccess: () => Promise<void>
    categoryCache: Record<string, { items: Array<Record<string, unknown>>, loaded: boolean }>
  }
  let definition: ReceivedPage
  let receivedModule: { listReceived: ReturnType<typeof vi.fn>, markReceivedRead: ReturnType<typeof vi.fn> }
  let identityModule: { beginProtectedAction: ReturnType<typeof vi.fn>, peekSnapshot: ReturnType<typeof vi.fn> }
  const titleStub = vi.fn()

  beforeAll(async () => {
    vi.stubGlobal('Page', (value: ReceivedPage) => {
      definition = value
    })
    vi.stubGlobal('wx', { setNavigationBarTitle: titleStub, setClipboardData: vi.fn(), showToast: vi.fn() })
    await import('../src/packages/member/mip-received/index')
    const opportunities = await import('../src/modules/mip-opportunities')
    receivedModule = opportunities.opportunityModule as unknown as typeof receivedModule
    const identity = await import('../src/modules/mip-identity/client')
    identityModule = identity.mipIdentityModule as unknown as typeof identityModule
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  function receivedPage(overrides: Record<string, unknown> = {}) {
    const instance = Object.create(definition!) as ReceivedPage
    instance.data = { ...structuredClone(definition!.data), ...overrides }
    instance.setData = (patch: Record<string, unknown>, callback?: () => void) => {
      Object.assign(instance.data, patch)
      callback?.()
    }
    instance.categoryCache = structuredClone(definition!.categoryCache)
    return instance
  }

  const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0))

  it('declares the journey navigation titles and D-01 tab names', () => {
    const page = read('src/packages/member/mip-received/index.ts')
    const view = read('src/packages/member/mip-received/index.wxml')
    const heartsView = read('src/packages/member/mip-hearts/index.wxml')

    expect(page).toContain(`GUEST: '嘉宾'`)
    expect(page).toContain(`INTERACTION: '互动过'`)
    expect(page).toContain(`ACTIVE_INTEREST: '心动值'`)
    expect(page).toContain(`VISITOR: '访客'`)
    expect(page).toContain(`wx.setNavigationBarTitle({ title: '心动值' })`)
    for (const name of ['我的心动', '对我心动']) {
      expect(view).toContain(name)
      expect(heartsView).toContain(name)
    }
    expect(view).not.toContain('你的心动')
    expect(view).not.toContain('对你心动')
    expect(heartsView).not.toContain('我点过的人')
    expect(heartsView).not.toContain('对我心动的人')
    // 只有互动过有搜索框（占位逐字），嘉宾/访客无搜索。
    expect(view).toContain('placeholder="搜索姓名，行业，简介等"')
    expect(view).toContain(`wx:if="{{category === 'INTERACTION'}}"`)
    expect(page).toContain('matchesInteractionSearch')
  })

  it('maps non-empty server responses onto the journey card contract (×N, 邀请人, 无时间访客卡)', async () => {
    const instance = receivedPage({ influenceMode: true, category: 'GUEST' })
    identityModule.beginProtectedAction.mockResolvedValue({ decision: { ready: true } })
    identityModule.peekSnapshot.mockReturnValue({ profile: { nickname: 'Bear' } })

    // J3-05 嘉宾：多次邀请 ×N + 邀请人标注（邀请人是我本人）。先过身份检查，
    // viewerName 从身份快照带入（邀请人标注）。
    receivedModule.listReceived.mockResolvedValueOnce({
      items: [{
        kind: 'GUEST',
        status: 'ACTIVE',
        actor: { profileRef: 'g1', nickname: '大鹅飞飞', headline: '深圳 MIP I 金融行业 I 激情创业者' },
        invitationCount: 3,
        event: { id: 'e1', title: '设计户外过两天再说露营地' },
        unread: false,
        updatedAt: '2026-09-20T10:00:00.000Z',
      }],
      unreadCount: 0,
    })
    await (instance as unknown as { checkAccess: () => Promise<void> }).checkAccess()
    expect(instance.data.viewerName).toBe('Bear')
    const guest = instance.categoryCache.GUEST.items[0]
    expect(guest).toMatchObject({
      actorName: '大鹅飞飞',
      metaText: '深圳 MIP I 金融行业 I 激情创业者',
      countBadge: '×3',
      noteText: '邀请人Bear',
    })
    expect(String(guest.navigationUrl)).toContain('/packages/member/mip-public-profile/index?profileRef=g1')

    // J3-06 互动过：同场多条事实合并成单卡 ×2，搜索按姓名/行业过滤。
    instance.data.category = 'INTERACTION'
    receivedModule.listReceived.mockResolvedValueOnce({
      items: [
        { kind: 'INTERACTION', interactionCount: 2, status: 'ACTIVE', actor: { profileRef: 'p1', nickname: '小玫瑰', headline: '金融行业 I 专业投资人' }, event: { id: 'e1', title: 'A场' }, unread: false, updatedAt: '2026-09-20T10:00:00.000Z' },
        { kind: 'INTERACTION', interactionCount: 2, status: 'ACTIVE', actor: { profileRef: 'p1', nickname: '小玫瑰', headline: '金融行业 I 专业投资人' }, event: { id: 'e2', title: 'B场' }, unread: false, updatedAt: '2026-09-19T10:00:00.000Z' },
        { kind: 'INTERACTION', status: 'ACTIVE', actor: { profileRef: 'p2', nickname: 'Nehz', headline: '激情创业者' }, event: { id: 'e1', title: 'A场' }, unread: false, updatedAt: '2026-09-18T10:00:00.000Z' },
      ],
      unreadCount: 0,
    })
    await instance.loadCategory('INTERACTION', true)
    const interactions = instance.categoryCache.INTERACTION.items
    expect(interactions).toHaveLength(2)
    expect(interactions[0]).toMatchObject({ actorName: '小玫瑰', countBadge: '×2' })
    expect(interactions[1]).toMatchObject({ actorName: 'Nehz', countBadge: '' })
    instance.applySearch('投资人')
    expect((instance.data.displayItems as Array<{ actorName: string }>).map(item => item.actorName)).toEqual(['小玫瑰'])
    instance.applySearch('不存在的名字')
    expect(instance.data.displayItems).toHaveLength(0)

    // J3-08 访客：卡片不显示访问时间（QT 终审），每次访问一条，无 ×N。
    instance.data.category = 'VISITOR'
    instance.data.searchInput = ''
    receivedModule.listReceived.mockResolvedValueOnce({
      items: [{ kind: 'VISITOR', status: 'ACTIVE', actor: { profileRef: 'v1', nickname: '菠萝大凤梨', headline: '金融行业 I 激情创业者' }, visitCount: 2, lastVisitedAt: '2026-09-21T08:00:00.000Z', unread: false }],
      unreadCount: 0,
      totalViewCount: 2,
    })
    await instance.loadCategory('VISITOR', true)
    const visitorView = read('src/packages/member/mip-received/index.wxml')
    const influenceGrid = visitorView.slice(visitorView.indexOf('journey-review J3-05/06/08'), visitorView.indexOf('journey-review J3-07'))
    expect(influenceGrid).not.toContain('updatedText')
    expect(instance.categoryCache.VISITOR.items[0]).toMatchObject({ actorName: '菠萝大凤梨', messageId: 'v1', countBadge: '' })
  })

  // review 补强：心动值页两 tab 切换与默认落点行为。
  it('keeps the hearts-mode tabs on the two journey lists with the default landing and lazy switching', async () => {
    titleStub.mockClear()
    receivedModule.listReceived.mockReset()
    receivedModule.listReceived.mockResolvedValue({ items: [], unreadCount: 0 })

    const instance = receivedPage()
    instance.onLoad({ scope: 'hearts' })
    expect(instance.data.heartsMode).toBe(true)
    expect(instance.data.category).toBe('ACTIVE_INTEREST')
    expect(titleStub).toHaveBeenCalledExactlyOnceWith({ title: '心动值' })

    // 显式 category 落点被尊重（我的心动 tab）。
    instance.onLoad({ scope: 'hearts', category: 'OUTBOUND_INTEREST' })
    expect(instance.data.category).toBe('OUTBOUND_INTEREST')

    // tabs 白名单：心动值页不接受默认模式的类目（引荐/访客等）。
    instance.changeCategory({ currentTarget: { dataset: { category: 'REFERRAL' } } })
    instance.changeCategory({ currentTarget: { dataset: { category: 'VISITOR' } } })
    expect(instance.data.category).toBe('OUTBOUND_INTEREST')
    expect(receivedModule.listReceived).not.toHaveBeenCalled()

    // 首切「对我心动」按需拉取一次；回切未加载 tab 再拉；已加载 tab 不重复拉。
    instance.changeCategory({ currentTarget: { dataset: { category: 'ACTIVE_INTEREST' } } })
    expect(instance.data.category).toBe('ACTIVE_INTEREST')
    await flushAsync()
    expect(receivedModule.listReceived).toHaveBeenCalledExactlyOnceWith('ACTIVE_INTEREST', undefined)
    expect(instance.categoryCache.ACTIVE_INTEREST.loaded).toBe(true)

    receivedModule.listReceived.mockClear()
    instance.changeCategory({ currentTarget: { dataset: { category: 'OUTBOUND_INTEREST' } } })
    await flushAsync()
    expect(receivedModule.listReceived).toHaveBeenCalledExactlyOnceWith('OUTBOUND_INTEREST', undefined)

    receivedModule.listReceived.mockClear()
    instance.changeCategory({ currentTarget: { dataset: { category: 'ACTIVE_INTEREST' } } })
    await flushAsync()
    expect(receivedModule.listReceived).not.toHaveBeenCalled()
    expect(instance.data.category).toBe('ACTIVE_INTEREST')
  })

  // review 补强：基线 app-page-exit 语义 + 心动值红点死 UI 移除的结构 pin。
  it('restores the baseline tail app-page-exit for every mode and drops the dead hearts unread dot', () => {
    const view = read('src/packages/member/mip-received/index.wxml')

    // 基线语义：ready 分支出口按钮只在 wx:else 块尾出现一次，
    // 对 figmaLayout / 影响力 / 心动值 / 默认四种渲染模式统一生效（默认模式含 app-page-exit 的 pin）。
    const readyBranch = view.slice(view.indexOf('<block wx:else>'))
    const exits = readyBranch.match(/<app-page-exit \/>/g) || []
    expect(exits).toHaveLength(1)
    expect(readyBranch.trimEnd().endsWith('<app-page-exit />\n  </block>\n</view>')).toBe(true)
    // 全页出口按钮共 3 处：access / error / ready 块尾。
    expect(view.match(/<app-page-exit \/>/g)).toHaveLength(3)

    // 心动值网格无红点死节点（ACTIVE_INTEREST 无服务端未读事实与 messageId，待口径后恢复；
    // presenter unread 字段保留）。从 hearts 块头搜下一个块级 wx:else（默认模式块）。
    const heartsStart = view.indexOf('journey-review J3-07')
    const heartsBlock = view.slice(heartsStart, view.indexOf('<block wx:else>', heartsStart))
    expect(heartsBlock).not.toBe('')
    expect(heartsBlock).not.toContain('item.unread')

    // 影响力网格保留 VISITOR 活红点；×N 使用真实次数与原型黄色角标。
    const influenceBlock = view.slice(view.indexOf('journey-review J3-05/06/08'), view.indexOf('journey-review J3-07'))
    expect(influenceBlock).toContain('wx:if="{{item.unread}}"')
    const countBadge = influenceBlock.match(/<view wx:if="\{\{item\.countBadge\}\}"[^>]*>\{\{item\.countBadge\}\}<\/view>/)?.[0] || ''
    expect(countBadge).toContain('bg-brand')
    expect(countBadge).toContain('text-on-brand')
    expect(countBadge).toContain('text-[20rpx]')
  })
})
