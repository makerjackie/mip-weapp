import type {
  AdminBranch,
  AdminGrowthLevel,
  AdminUser,
  AdminUserDetail,
  AdminUserInfluenceDirection,
  AdminUserInfluenceFact,
  AdminUserInfluenceKind,
  AdminUserPrimaryBranchOption,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'
import {
  appendPrivatePhones,
  clearPrivatePhones,
  maskedPhone,
  privatePhone,
  replacePrivatePhones,
} from '../shared/private-phone'

type AdminUserView = Omit<AdminUser, 'phoneNumber'> & {
  phoneNumberMasked: string
  controlText: string
  hasAllowlist: boolean
  hasBlocklist: boolean
  createdText: string
  statusText: string
  statusTheme: 'default' | 'success' | 'danger'
}

type AdminUserDetailView = Omit<AdminUserDetail, 'phoneNumber' | 'relatedRecords'> & {
  phoneNumberMasked: string
  statusText: string
  membershipText: string
  membershipEndsText: string
  firstPlayerText: string
  latestEntitlementEndsText: string
  totalValidMembershipText: string
  relatedRecords: AdminUserDetail['relatedRecords'] & {
    orders: Array<AdminUserDetail['relatedRecords']['orders'][number] & { amountText: string }>
  }
}

type AdminUserInfluenceFactView = AdminUserInfluenceFact & {
  kindText: string
  directionText: string
  statusText: string
  statusTheme: 'default' | 'success' | 'warning'
  occurredText: string
  counterpartText: string
  counterpartMetaText: string
}

interface PrimaryBranchOption {
  id: string
  label: string
}

const userStatusLabels: Record<AdminUser['status'], string> = {
  ACTIVE: '正常',
  BLOCKED: '已限制',
  CLOSED: '已关闭',
}

const userStatusThemes: Record<AdminUser['status'], AdminUserView['statusTheme']> = {
  ACTIVE: 'success',
  BLOCKED: 'danger',
  CLOSED: 'default',
}

const membershipStatusLabels: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '已结束',
  EXPIRED: '已过期',
  REVOKED: '已撤销',
  REFUNDED: '已退款',
}

const influenceKindLabels: Record<AdminUserInfluenceKind, string> = {
  INVITATION: '邀请嘉宾',
  HEART: '心动关系',
  VISIT: '档案访问',
}

const influenceStatusLabels: Record<string, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  PAYMENT_PENDING: '待支付',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '取消处理中',
  CANCELLED: '已取消',
  REJECTED: '已拒绝',
  ATTENDED: '已到场',
  ACTIVE: '有效',
  READ: '已读',
  UNREAD: '未读',
}

const influenceCounterpartFallback: Record<AdminUserInfluenceFact['counterpartState'], string> = {
  AVAILABLE: '未填写昵称',
  REDACTED: 'MIP 用户',
  UNAVAILABLE: '用户已不可用',
  NOT_RETAINED: '对方记录未保留',
  NOT_APPLICABLE: '平台邀请',
}

function userView(item: AdminUser): AdminUserView {
  const { phoneNumber, ...publicItem } = item
  return {
    ...publicItem,
    phoneNumberMasked: maskedPhone(phoneNumber),
    controlText: item.controls.join('、'),
    hasAllowlist: item.controls.includes('ALLOWLIST'),
    hasBlocklist: item.controls.includes('BLOCKLIST'),
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '未记录',
    statusText: userStatusLabels[item.status],
    statusTheme: userStatusThemes[item.status],
  }
}

function userDetailView(detail: AdminUserDetail): AdminUserDetailView {
  const { phoneNumber, relatedRecords, ...publicDetail } = detail
  return {
    ...publicDetail,
    phoneNumberMasked: maskedPhone(phoneNumber),
    statusText: userStatusLabels[detail.status],
    membershipText: detail.membership
      ? detail.membership.isCurrent
        ? '有效'
        : detail.membership.isScheduled
          ? '待生效'
          : membershipStatusLabels[detail.membership.status] || '状态待确认'
      : '非会员',
    membershipEndsText: detail.membership?.endsAt ? formatLocalDateTime(detail.membership.endsAt) : '未设置',
    firstPlayerText: detail.firstPlayerAt ? formatLocalDateTime(detail.firstPlayerAt) : '',
    latestEntitlementEndsText: detail.latestEntitlementEndsAt
      ? formatLocalDateTime(detail.latestEntitlementEndsAt)
      : '',
    totalValidMembershipText: formatMembershipDuration(detail.totalValidMembershipSeconds || 0),
    relatedRecords: {
      ...relatedRecords,
      orders: relatedRecords.orders.map(order => ({
        ...order,
        amountText: `${(order.amountCents / 100).toFixed(2)} 元`,
      })),
    },
  }
}

function formatMembershipDuration(seconds: number) {
  const totalDays = Math.floor(seconds / 86_400)
  if (totalDays < 365) {
    return `${totalDays} 天`
  }
  const years = Math.floor(totalDays / 365)
  const days = totalDays % 365
  return days ? `${years} 年 ${days} 天` : `${years} 年`
}

function primaryBranchEditorOptions(options: AdminUserPrimaryBranchOption[]): PrimaryBranchOption[] {
  return options.map(branch => ({ id: branch.id, label: `${branch.name} · ${branch.cityName}` }))
}

function userInfluenceView(item: AdminUserInfluenceFact): AdminUserInfluenceFactView {
  const statusTheme = item.status === 'ACTIVE'
    || item.status === 'REGISTERED'
    || item.status === 'ATTENDED'
    || item.status === 'READ'
    ? 'success'
    : item.status === 'UNREAD' || item.status.includes('PENDING') || item.status === 'WAITLISTED'
      ? 'warning'
      : 'default'
  return {
    ...item,
    kindText: influenceKindLabels[item.kind],
    directionText: item.direction === 'INCOMING' ? '对该用户发起' : '由该用户发起',
    statusText: influenceStatusLabels[item.status] || item.status,
    statusTheme,
    occurredText: formatLocalDateTime(item.occurredAt),
    counterpartText: item.counterpartNickname
      || influenceCounterpartFallback[item.counterpartState],
    counterpartMetaText: item.counterpartKind
      ? (item.counterpartKind === 'PLAYER' ? '玩家' : '嘉宾')
      : '',
  }
}

function selectedPrimaryBranchIndex(options: PrimaryBranchOption[], branchId: string | null) {
  return branchId ? options.findIndex(option => option.id === branchId) : -1
}

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(
    parts[0],
    parts[1] - 1,
    parts[2],
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    users: [] as AdminUserView[],
    query: '',
    kind: '',
    playerLifecycle: '',
    status: '',
    controlType: '',
    phoneBound: '',
    profileComplete: '',
    joinedWithinDays: 0,
    branchId: '',
    branchLabel: '全部分会',
    branches: [] as AdminBranch[],
    levelId: '',
    levelLabel: '全部等级',
    levels: [] as AdminGrowthLevel[],
    experienceMin: '',
    experienceMax: '',
    createdFromDate: '',
    createdToDate: '',
    includePhone: false,
    canPhone: false,
    canEdit: false,
    canControl: false,
    canExport: false,
    canFilterBranches: false,
    canChangePrimaryBranch: false,
    canReadMembership: false,
    canManageUserContent: false,
    primaryBranchOptions: [] as PrimaryBranchOption[],
    primaryBranchLabels: [] as string[],
    primaryBranchIndex: -1,
    primaryBranchReason: '',
    primaryBranchSaving: false,
    primaryBranchMessage: '',
    processingId: '',
    exportPending: false,
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
    detailOpen: false,
    detailState: 'loading' as AdminPageState,
    detail: null as AdminUserDetailView | null,
    detailMessage: '',
    influenceState: 'loading' as AdminPageState,
    influenceKind: 'INVITATION' as AdminUserInfluenceKind,
    influenceDirection: 'ALL' as AdminUserInfluenceDirection,
    influenceFromDate: '',
    influenceToDate: '',
    influenceItems: [] as AdminUserInfluenceFactView[],
    influenceNextCursor: null as string | null,
    influenceLoadingMore: false,
    influenceMessage: '',
    influenceUnavailableMessage: '',
    influenceEmptyTitle: '没有邀请记录',
  },
  requestSeq: 0,
  detailRequestSeq: 0,
  influenceRequestSeq: 0,
  confirmationBusy: false,
  onLoad(options: { levelId?: string }) {
    if (options?.levelId) {
      this.setData({ levelId: String(options.levelId) })
    }
  },
  onShow() { void this.loadUsers() },
  onHide() {
    this.requestSeq += 1
    this.detailRequestSeq += 1
    this.influenceRequestSeq += 1
    mipAdminModule.clearSensitive()
    clearPrivatePhones(this)
    this.setData({
      includePhone: false,
      detailOpen: false,
      detail: null,
      influenceItems: [],
      influenceNextCursor: null,
      influenceMessage: '',
      influenceUnavailableMessage: '',
      users: this.data.users.map(item => ({ ...item, phoneNumberMasked: '' })),
    })
  },
  onUnload() {
    this.requestSeq += 1
    this.detailRequestSeq += 1
    this.influenceRequestSeq += 1
    mipAdminModule.clearSensitive()
    clearPrivatePhones(this)
  },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  updateRangeFilter(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['experienceMin', 'experienceMax'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  changeCreatedDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['createdFromDate', 'createdToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },
  clearCreatedDates() {
    this.setData({ createdFromDate: '', createdToDate: '' })
    void this.loadUsers(true)
  },
  chooseFilter(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['kind', 'playerLifecycle', 'status', 'controlType', 'phoneBound', 'profileComplete', 'joinedWithinDays'].includes(field)) {
      return
    }
    this.setData({ [field]: field === 'joinedWithinDays'
      ? Number(event.currentTarget.dataset.value || 0)
      : String(event.currentTarget.dataset.value || '') })
    void this.loadUsers(true)
  },
  search() { void this.loadUsers(true) },
  async loadUsers(force = false) {
    const hasContent = this.data.users.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    const includePhone = this.data.includePhone
    clearPrivatePhones(this)
    try {
      const [session, response] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.users.list({
          includePhone,
          filters: {
            query: this.data.query.trim(),
            kind: this.data.kind,
            playerLifecycle: this.data.playerLifecycle,
            status: this.data.status,
            controlType: this.data.controlType,
            phoneBound: this.data.phoneBound,
            profileComplete: this.data.profileComplete,
            joinedWithinDays: this.data.joinedWithinDays,
            branchId: this.data.branchId,
            levelId: this.data.levelId,
            experienceMin: this.data.experienceMin,
            experienceMax: this.data.experienceMax,
            createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
            createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
          },
        }, force),
      ])
      if (seq !== this.requestSeq) {
        return
      }
      const canPhone = hasCapability(session.capabilities, 'users.phone.read')
      const canFilterBranches = hasCapability(session.capabilities, 'branches.manage')
      const canChangePrimaryBranch = session.capabilities.some(grant => (
        grant.capability === 'users.fields.edit' && grant.scopeType === 'PLATFORM'
      ))
      if (canPhone && includePhone) {
        replacePrivatePhones(this, response.items)
      }
      this.setData({
        state: 'ready',
        users: response.items.map(userView),
        canPhone,
        canEdit: hasCapability(session.capabilities, 'users.fields.edit'),
        canControl: hasCapability(session.capabilities, 'users.access.manage'),
        canExport: hasCapability(session.capabilities, 'exports.create'),
        canFilterBranches,
        canChangePrimaryBranch,
        canReadMembership: hasCapability(session.capabilities, 'memberships.read'),
        canManageUserContent: hasCapability(session.capabilities, 'userContent.moderate'),
        nextCursor: response.nextCursor || null,
        loadingMore: false,
        message: '',
      })
      if (canFilterBranches && !this.data.branches.length) {
        void this.loadBranches()
      }
      if (hasCapability(session.capabilities, 'growth.read') && !this.data.levels.length) {
        void this.loadGrowthLevels()
      }
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '用户列表加载失败' }))
    }
  },
  async loadMoreUsers() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    const seq = this.requestSeq
    const includePhone = this.data.includePhone
    this.setData({ loadingMore: true, message: '' })
    try {
      const response = await mipAdminModule.users.list({
        includePhone,
        cursor: this.data.nextCursor,
        filters: {
          query: this.data.query.trim(),
          kind: this.data.kind,
          playerLifecycle: this.data.playerLifecycle,
          status: this.data.status,
          controlType: this.data.controlType,
          phoneBound: this.data.phoneBound,
          profileComplete: this.data.profileComplete,
          joinedWithinDays: this.data.joinedWithinDays,
          branchId: this.data.branchId,
          levelId: this.data.levelId,
          experienceMin: this.data.experienceMin,
          experienceMax: this.data.experienceMax,
          createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
          createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
        },
      })
      if (seq !== this.requestSeq) {
        return
      }
      if (this.data.canPhone && includePhone) {
        appendPrivatePhones(this, response.items)
      }
      const users = response.items.map(userView)
      this.setData({ users: this.data.users.concat(users), nextCursor: response.nextCursor || null })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '更多用户加载失败' })
    }
    finally {
      if (seq === this.requestSeq) {
        this.setData({ loadingMore: false })
      }
    }
  },
  async loadBranches() {
    try {
      const response = await mipAdminModule.listBranches()
      this.setData({ branches: response.items })
    }
    catch {
      this.setData({ message: '分会筛选暂时无法加载。' })
    }
  },
  async loadGrowthLevels() {
    try {
      const response = await mipAdminModule.listGrowthLevels()
      this.setData({ levels: response.items })
    }
    catch {
      this.setData({ message: '等级筛选暂时无法加载。' })
    }
  },
  async chooseBranch() {
    if (!this.data.canFilterBranches || !this.data.branches.length) {
      return
    }
    try {
      const choices = ['全部分会', ...this.data.branches.map(branch => `${branch.name} · ${branch.cityName}`)]
      const result = await wx.showActionSheet({ itemList: choices })
      const branch = result.tapIndex > 0 ? this.data.branches[result.tapIndex - 1] : null
      this.setData({ branchId: branch?.id || '', branchLabel: branch?.name || '全部分会' })
      void this.loadUsers(true)
    }
    catch {
      // Closing the native selector leaves the current filter unchanged.
    }
  },
  async chooseLevel() {
    if (!this.data.levels.length) {
      return
    }
    try {
      const choices = ['全部等级', ...this.data.levels.map(level => `${level.name} · ${level.minimumExperience} 经验`)]
      const result = await wx.showActionSheet({ itemList: choices })
      const level = result.tapIndex > 0 ? this.data.levels[result.tapIndex - 1] : null
      this.setData({ levelId: level?.id || '', levelLabel: level?.name || '全部等级' })
      void this.loadUsers(true)
    }
    catch {
      // Closing the native selector leaves the current filter unchanged.
    }
  },
  onReachBottom() { void this.loadMoreUsers() },
  openGrowthTransitions() {
    const userId = this.data.detail?.id
    if (userId) {
      void wx.navigateTo({ url: `/packages/admin/growth-transitions/index?userId=${userId}` })
    }
  },
  async openDetail(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    if (!userId) {
      return
    }
    this.influenceRequestSeq += 1
    this.setData({
      detailOpen: true,
      influenceState: 'loading',
      influenceKind: 'INVITATION',
      influenceDirection: 'ALL',
      influenceFromDate: '',
      influenceToDate: '',
      influenceItems: [],
      influenceNextCursor: null,
      influenceLoadingMore: false,
      influenceMessage: '',
      influenceUnavailableMessage: '',
      influenceEmptyTitle: '没有邀请记录',
    })
    await this.loadUserDetail(userId, true)
  },
  async loadUserDetail(userId: string, resetPrimaryBranchEditor: boolean) {
    const seq = this.detailRequestSeq + 1
    this.detailRequestSeq = seq
    const includePhone = this.data.includePhone
    if (resetPrimaryBranchEditor) {
      this.setData({
        detailState: 'loading',
        detail: null,
        detailMessage: '',
        primaryBranchReason: '',
        primaryBranchMessage: '',
      })
    }
    try {
      const detail = await mipAdminModule.users.get(userId, includePhone, true)
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      if (this.data.canPhone && includePhone) {
        appendPrivatePhones(this, [detail])
      }
      const primaryBranchOptions = primaryBranchEditorOptions(detail.primaryBranchOptions || [])
      this.setData({
        detailState: 'ready',
        detail: userDetailView(detail),
        primaryBranchOptions,
        primaryBranchLabels: primaryBranchOptions.map(option => option.label),
        primaryBranchIndex: selectedPrimaryBranchIndex(primaryBranchOptions, detail.primaryBranchId),
        primaryBranchMessage: this.data.canChangePrimaryBranch && !primaryBranchOptions.length
          ? '当前没有可选择的有效分会。'
          : '',
      })
      void this.loadUserInfluence(userId, true)
    }
    catch (error) {
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      this.setData({
        detailState: 'error',
        detailMessage: error instanceof Error ? error.message : '用户详情加载失败',
      })
    }
  },
  chooseInfluenceFilter(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = String(event.currentTarget.dataset.value || '')
    if (field === 'influenceKind' && ['INVITATION', 'HEART', 'VISIT'].includes(value)) {
      this.setData({
        influenceKind: value as AdminUserInfluenceKind,
        influenceEmptyTitle: value === 'INVITATION'
          ? '没有邀请记录'
          : value === 'HEART'
            ? '没有心动记录'
            : '没有访问记录',
      })
    }
    else if (field === 'influenceDirection' && ['ALL', 'INCOMING', 'OUTGOING'].includes(value)) {
      this.setData({ influenceDirection: value as AdminUserInfluenceDirection })
    }
    else {
      return
    }
    const userId = this.data.detail?.id
    if (userId) {
      void this.loadUserInfluence(userId, true)
    }
  },
  changeInfluenceDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['influenceFromDate', 'influenceToDate'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
    const userId = this.data.detail?.id
    if (userId) {
      void this.loadUserInfluence(userId, true)
    }
  },
  clearInfluenceDates() {
    this.setData({ influenceFromDate: '', influenceToDate: '' })
    const userId = this.data.detail?.id
    if (userId) {
      void this.loadUserInfluence(userId, true)
    }
  },
  retryInfluence() {
    const userId = this.data.detail?.id
    if (userId) {
      void this.loadUserInfluence(userId, true)
    }
  },
  loadMoreInfluence() {
    const userId = this.data.detail?.id
    if (userId && this.data.influenceNextCursor && !this.data.influenceLoadingMore) {
      void this.loadUserInfluence(userId, false)
    }
  },
  async loadUserInfluence(userId: string, reset: boolean) {
    if (this.data.influenceFromDate
      && this.data.influenceToDate
      && this.data.influenceFromDate > this.data.influenceToDate) {
      this.influenceRequestSeq += 1
      this.setData({
        influenceState: 'error',
        influenceItems: [],
        influenceNextCursor: null,
        influenceMessage: '开始日期不能晚于结束日期。',
      })
      return
    }
    const cursor = reset ? null : this.data.influenceNextCursor
    if (!reset && !cursor) {
      return
    }
    const seq = this.influenceRequestSeq + 1
    this.influenceRequestSeq = seq
    this.setData(reset
      ? {
          influenceState: 'loading',
          influenceItems: [],
          influenceNextCursor: null,
          influenceLoadingMore: false,
          influenceMessage: '',
          influenceUnavailableMessage: '',
        }
      : { influenceLoadingMore: true, influenceMessage: '' })
    try {
      const response = await mipAdminModule.users.listInfluence({
        userId,
        kind: this.data.influenceKind,
        direction: this.data.influenceDirection,
        ...(this.data.influenceFromDate
          ? { occurredFrom: dateBoundary(this.data.influenceFromDate, false) }
          : {}),
        ...(this.data.influenceToDate
          ? { occurredTo: dateBoundary(this.data.influenceToDate, true) }
          : {}),
        ...(cursor ? { cursor } : {}),
        limit: 10,
      }, reset)
      if (!this.data.detailOpen
        || this.data.detail?.id !== userId
        || seq !== this.influenceRequestSeq) {
        return
      }
      const items = response.items.map(userInfluenceView)
      this.setData({
        influenceState: 'ready',
        influenceItems: reset ? items : this.data.influenceItems.concat(items),
        influenceNextCursor: response.nextCursor,
        influenceLoadingMore: false,
        influenceMessage: '',
        influenceUnavailableMessage: response.unavailableFacts.includes('CANCELLED_INCOMING_HEART')
          ? '已取消的入向心动未保留关系对方，当前不可查询。'
          : '',
      })
    }
    catch (error) {
      if (!this.data.detailOpen
        || this.data.detail?.id !== userId
        || seq !== this.influenceRequestSeq) {
        return
      }
      this.setData({
        influenceState: this.data.influenceItems.length ? 'ready' : 'error',
        influenceLoadingMore: false,
        influenceMessage: error instanceof Error ? error.message : '用户影响力加载失败',
      })
    }
  },
  closeDetail() {
    this.detailRequestSeq += 1
    this.influenceRequestSeq += 1
    this.setData({
      detailOpen: false,
      detail: null,
      detailMessage: '',
      primaryBranchReason: '',
      primaryBranchMessage: '',
      primaryBranchSaving: false,
      influenceItems: [],
      influenceNextCursor: null,
      influenceLoadingMore: false,
      influenceMessage: '',
      influenceUnavailableMessage: '',
    })
    mipAdminModule.clearSensitive()
  },
  changePrimaryBranchSelection(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const primaryBranchIndex = Number(event.detail.value)
    if (this.data.primaryBranchOptions[primaryBranchIndex]) {
      this.setData({ primaryBranchIndex, primaryBranchMessage: '' })
    }
  },
  updatePrimaryBranchReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ primaryBranchReason: event.detail.value })
  },
  async changePrimaryBranch() {
    const detail = this.data.detail
    const option = this.data.primaryBranchOptions[this.data.primaryBranchIndex]
    const reason = this.data.primaryBranchReason.trim()
    if (!this.data.canChangePrimaryBranch || !detail || this.data.primaryBranchSaving) {
      return
    }
    if (!option) {
      this.setData({ primaryBranchMessage: '请选择目标分会。' })
      return
    }
    if (option.id === detail.primaryBranchId) {
      this.setData({ primaryBranchMessage: '请选择其他分会。' })
      return
    }
    if (!reason) {
      this.setData({ primaryBranchMessage: '请填写变更原因。' })
      return
    }

    const userId = detail.id
    this.setData({ primaryBranchSaving: true, primaryBranchMessage: '' })
    try {
      await mipAdminModule.users.changePrimaryBranch({
        userId,
        targetBranchId: option.id,
        expectedVersion: detail.userVersion,
        reason,
      })
      await this.loadUsers(true)
      if (this.data.detailOpen) {
        await this.loadUserDetail(userId, true)
      }
      wx.showToast({ title: '主分会已更新', icon: 'success' })
    }
    catch (error) {
      if (error instanceof MipAdminError && error.code === 'CONFLICT') {
        await this.loadUsers(true)
        if (this.data.detailOpen) {
          await this.loadUserDetail(userId, true)
          this.setData({
            primaryBranchReason: reason,
            primaryBranchMessage: '用户信息已更新，请确认当前分会后重试。',
          })
        }
      }
      else {
        this.setData({
          primaryBranchMessage: error instanceof Error ? error.message : '主分会更新失败',
        })
      }
    }
    finally {
      this.setData({ primaryBranchSaving: false })
    }
  },
  openRelatedOpportunity(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/opportunity-detail/index?id=${String(event.currentTarget.dataset.id || '')}` })
  },
  openRelatedCase(event: WechatMiniprogram.TouchEvent) {
    const userId = this.data.detail?.id || ''
    const contentId = String(event.currentTarget.dataset.id || '')
    if (this.data.canManageUserContent && userId && contentId) {
      void wx.navigateTo({
        url: `/packages/admin/user-content/index?ownerUserId=${encodeURIComponent(userId)}&kind=SUPER_CASE&contentId=${encodeURIComponent(contentId)}`,
      })
      return
    }
    if (contentId) {
      void wx.navigateTo({ url: `/packages/member/mip-cases/detail/index?id=${encodeURIComponent(contentId)}` })
    }
  },
  openUserContent(event: WechatMiniprogram.TouchEvent) {
    const userId = this.data.detail?.id || ''
    const kind = String(event.currentTarget.dataset.kind || '')
    if (this.data.canManageUserContent
      && userId
      && ['COOPERATION_CARD', 'SUPER_CASE'].includes(kind)) {
      void wx.navigateTo({
        url: `/packages/admin/user-content/index?ownerUserId=${encodeURIComponent(userId)}&kind=${kind}`,
      })
    }
  },
  openRelatedRegistration(event: WechatMiniprogram.TouchEvent) {
    void wx.navigateTo({ url: `/packages/admin/event-registrations/index?eventId=${String(event.currentTarget.dataset.id || '')}` })
  },
  openOrders() { void wx.navigateTo({ url: '/packages/admin/orders/index' }) },
  openMembership() {
    const userId = this.data.detail?.id
    if (this.data.canReadMembership && userId) {
      void wx.navigateTo({
        url: `/packages/admin/membership/index?userId=${encodeURIComponent(userId)}`,
      })
    }
  },
  handleDetailVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeDetail()
    }
  },
  async showPhones() {
    if (!this.data.canPhone || this.data.processingId || this.data.exportPending || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    try {
      const modal = await wx.showModal({
        title: '查看手机号原文',
        content: '手机号仅用于已授权的会员服务和运营联系。',
      })
      if (!modal.confirm) {
        return
      }
      this.setData({ includePhone: true })
      await this.loadUsers(true)
      if (this.data.detailOpen && this.data.detail?.id) {
        const detailId = this.data.detail.id
        const seq = this.detailRequestSeq + 1
        this.detailRequestSeq = seq
        const detail = await mipAdminModule.users.get(detailId, true, true)
        if (this.data.detailOpen && this.data.detail?.id === detailId && seq === this.detailRequestSeq) {
          appendPrivatePhones(this, [detail])
          this.setData({ detail: userDetailView(detail) })
        }
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号加载失败' })
    }
    finally {
      this.confirmationBusy = false
    }
  },
  async revealPhone(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canPhone || !this.data.includePhone) {
      return
    }
    const phone = privatePhone(this, String(event.currentTarget.dataset.id || ''))
    if (!phone) {
      wx.showToast({ title: '手机号暂不可用', icon: 'none' })
      return
    }
    const modal = await wx.showModal({
      title: '手机号',
      content: phone,
      confirmText: '复制号码',
      cancelText: '关闭',
    })
    if (modal.confirm) {
      await wx.setClipboardData({ data: phone })
    }
  },
  async editField(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    const version = Number(event.currentTarget.dataset.version)
    const field = String(event.currentTarget.dataset.field || '')
    const fieldLabels: Record<string, string> = {
      nickname: '昵称',
      headline: '资料标题',
      introduction: '个人介绍',
    }
    if (!userId || !fieldLabels[field] || !this.data.canEdit || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({
        title: `编辑${fieldLabels[field]}`,
        editable: true,
        placeholderText: `输入${fieldLabels[field]}`,
      })
      if (!modal.confirm) {
        return
      }
      await mipAdminModule.users.update({
        userId,
        expectedVersion: version,
        fields: { [field]: modal.content },
      })
      wx.showToast({ title: '资料已更新', icon: 'success' })
      await this.loadUsers(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '资料更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async setControl(event: WechatMiniprogram.TouchEvent) {
    const userId = String(event.currentTarget.dataset.id || '')
    const controlType = String(event.currentTarget.dataset.type || '')
    const active = event.currentTarget.dataset.active === true || event.currentTarget.dataset.active === 'true'
    if (!userId || !this.data.canControl || this.data.processingId) {
      return
    }
    this.setData({ processingId: userId, message: '' })
    try {
      const modal = await wx.showModal({ title: active ? '设置名单' : '撤销名单', editable: true, placeholderText: '填写操作原因' })
      if (!modal.confirm || !modal.content.trim()) {
        return
      }
      await mipAdminModule.users.setControl({ userId, controlType, active, reason: modal.content })
      wx.showToast({ title: '名单状态已更新', icon: 'success' })
      await this.loadUsers(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名单状态更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
  async createExport() {
    if (!this.data.canExport || this.data.exportPending || this.data.processingId || this.confirmationBusy) {
      return
    }
    this.confirmationBusy = true
    this.setData({ exportPending: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '创建用户导出',
        content: '导出文件仅用于已授权的运营工作，有效期较短。',
      })
      if (!modal.confirm) {
        return
      }
      const result = await mipAdminModule.exportAndOpen({
        exportType: 'USERS',
        includesPhone: this.data.includePhone,
        filters: {
          query: this.data.query,
          kind: this.data.kind,
          playerLifecycle: this.data.playerLifecycle,
          status: this.data.status,
          controlType: this.data.controlType,
          phoneBound: this.data.phoneBound,
          profileComplete: this.data.profileComplete,
          joinedWithinDays: this.data.joinedWithinDays,
          branchId: this.data.branchId,
          levelId: this.data.levelId,
          experienceMin: this.data.experienceMin,
          experienceMax: this.data.experienceMax,
          createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
          createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
        },
      })
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '导出任务创建失败' })
    }
    finally {
      this.confirmationBusy = false
      this.setData({ exportPending: false })
    }
  },
})
