import type {
  AdminRegistrationStatus,
  AdminRosterItem,
  AdminRosterPage,
  AdminRosterStatusFilter,
} from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { AdminGatewayError } from '../../../modules/admin/cloudbase-gateway'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

interface DisplayRosterItem extends AdminRosterItem {
  initial: string
  registeredText: string
  attendedText: string
  statusText: string
  actionBusy: boolean
}

const statusLabels: Record<AdminRegistrationStatus, string> = {
  PENDING_REVIEW: '待审核',
  WAITLISTED: '候补中',
  REGISTERED: '已报名',
  CANCELLATION_PENDING: '退款中',
  ATTENDED: '已签到',
  REJECTED: '未通过',
  CANCELLED: '已取消',
}

const emptyCopy: Record<AdminRosterStatusFilter, { title: string, description: string }> = {
  ALL: { title: '还没有报名', description: '有人报名后会出现在这里。' },
  PENDING_REVIEW: { title: '没有待审核报名', description: '新的报名申请会出现在这里。' },
  WAITLISTED: { title: '没有候补成员', description: '满员后的候补报名会按顺序排列。' },
  REGISTERED: { title: '没有待签到报名', description: '当前筛选下没有已报名记录。' },
  CANCELLATION_PENDING: { title: '没有退款中的报名', description: '付费报名取消后会在这里显示退款进度。' },
  ATTENDED: { title: '还没有签到记录', description: '完成签到后会出现在这里。' },
  REJECTED: { title: '没有未通过记录', description: '被拒绝的报名申请会出现在这里。' },
  CANCELLED: { title: '没有取消记录', description: '用户或主办方取消的报名会出现在这里。' },
}

const UNDO_CATEGORIES = [
  { value: 'MISTAP', label: '误点签到' },
  { value: 'WRONG_PERSON', label: '签错人' },
  { value: 'OPERATOR_ERROR', label: '操作失误' },
  { value: 'OTHER', label: '其他' },
] as const

function displayItem(item: AdminRosterItem, busyId: string): DisplayRosterItem {
  return {
    ...item,
    initial: item.nickname.slice(0, 1) || '访',
    registeredText: item.registeredAt ? formatLocalDateTime(item.registeredAt) : '',
    attendedText: item.attendedAt ? formatLocalDateTime(item.attendedAt) : '',
    statusText: statusLabels[item.status] || item.status,
    actionBusy: busyId === item.id,
  }
}

function rosterQuery(eventId: string, status: AdminRosterStatusFilter, query: string, cursor: string | null = null) {
  return {
    eventId,
    status,
    query: query.trim(),
    cursor,
    limit: 20,
  }
}

function presentationSignature(items: DisplayRosterItem[]): string {
  return items.map(item => [
    item.id,
    item.status,
    item.version,
    item.attendedAt || '',
    item.ticketCodeMasked,
    item.nickname,
    item.city,
    item.phoneBound ? '1' : '0',
    item.phoneNumber || '',
    item.avatarUrl || '',
    item.answers.map(answer => `${answer.label}:${answer.value}`).join(','),
  ].join('|')).join(';')
}

function newIdempotencyKey() {
  return `ik_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    title: '',
    startsText: '',
    status: 'ALL' as AdminRosterStatusFilter,
    searchInput: '',
    activeQuery: '',
    items: [] as DisplayRosterItem[],
    nextCursor: null as string | null,
    loadingMore: false,
    registrationCount: 0,
    pendingReviewCount: 0,
    waitlistedCount: 0,
    cancellationPendingCount: 0,
    attendedCount: 0,
    rejectedCount: 0,
    cancelledCount: 0,
    totalCount: 0,
    expandedId: '',
    processingId: '',
    exporting: false,
    scanning: false,
    message: '',
    emptyTitle: emptyCopy.ALL.title,
    emptyDescription: emptyCopy.ALL.description,
    canOverrideCheckIn: false,
    canViewSensitiveRoster: false,
    canExportRoster: false,
    canReviewRegistration: false,
    canCheckIn: false,
    canUndoCheckIn: false,
    undoDialogVisible: false,
    undoRegistrationId: '',
    undoVersion: 0,
    undoNickname: '',
    undoCategory: 'MISTAP',
    undoCategories: UNDO_CATEGORIES,
    undoReasonText: '',
    undoing: false,
    rejectDialogVisible: false,
    reviewRegistrationId: '',
    reviewVersion: 0,
    reviewNickname: '',
    reviewReason: '',
  },

  requestSeq: 0,
  loadMoreSeq: 0,
  /** Generation that currently owns loadingMore UI state. */
  loadingMoreSeq: 0,
  searchTimer: 0 as number | ReturnType<typeof setTimeout>,
  /** Local latch: prevents stacked modals / concurrent confirmations. */
  confirmationBusy: false,
  presentationSig: '',

  onLoad(query: Record<string, string>) {
    this.setData({
      eventId: query.eventId || '',
      title: query.title ? decodeURIComponent(query.title) : '',
    })
  },

  onShow() {
    void this.loadRoster()
  },

  onUnload() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
  },

  changeStatus(event: WechatMiniprogram.CustomEvent<{ value: AdminRosterStatusFilter }>) {
    const status = event.detail.value
    this.setData({
      status,
      emptyTitle: emptyCopy[status].title,
      emptyDescription: emptyCopy[status].description,
      nextCursor: null,
    })
    void this.loadRoster(true, { reset: true })
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const searchInput = event.detail.value
    this.setData({ searchInput })
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
    }
    // Debounce 300ms; keep previous ready results until the new response lands.
    this.searchTimer = setTimeout(() => {
      void this.commitSearch()
    }, 300)
  },

  onSearchConfirm() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
    void this.commitSearch()
  },

  clearSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = 0
    }
    this.setData({ searchInput: '', activeQuery: '' })
    void this.loadRoster(true, { reset: true })
  },

  toggleDetails(event: WechatMiniprogram.BaseEvent) {
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    if (registrationId) {
      this.setData({
        expandedId: this.data.expandedId === registrationId ? '' : registrationId,
      })
    }
  },

  async commitSearch() {
    const activeQuery = this.data.searchInput.trim()
    if (activeQuery && activeQuery.length < 2) {
      this.setData({ message: '搜索词至少 2 个字符' })
      return
    }
    this.setData({ activeQuery, message: '' })
    await this.loadRoster(true, { reset: true })
  },

  async loadRoster(force = false, _options: { reset?: boolean } = {}) {
    if (!this.data.eventId) {
      this.setData({ state: 'error', message: '缺少活动参数' })
      return
    }
    // First-page reloads always replace the list; loadMore owns append pagination.
    const query = rosterQuery(
      this.data.eventId,
      this.data.status,
      this.data.activeQuery,
      null,
    )
    const cached = adminModule.peekEventRegistrations(query)
    if (cached && this.data.state !== 'ready') {
      this.applyPage(cached, { append: false })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }

    const seq = this.requestSeq + 1
    this.requestSeq = seq
    // Invalidate in-flight loadMore and release its operation loading immediately.
    this.loadMoreSeq += 1
    this.loadingMoreSeq = 0
    if (this.data.loadingMore) {
      this.setData({ loadingMore: false })
    }
    try {
      const page = await adminModule.listEventRegistrations(query, { force })
      if (seq !== this.requestSeq) {
        return
      }
      this.applyPage(page, { append: false })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '名单加载失败',
      }))
    }
  },

  applyPage(page: AdminRosterPage, options: { append: boolean }) {
    const busyId = this.data.processingId
    const incoming = page.items.map(item => displayItem(item, busyId))
    const items = options.append
      ? [...this.data.items, ...incoming.filter(item => !this.data.items.some(existing => existing.id === item.id))]
      : incoming
    const nextSig = presentationSignature(items)
    const countsChanged = this.data.registrationCount !== page.event.registrationCount
      || this.data.pendingReviewCount !== page.event.pendingReviewCount
      || this.data.waitlistedCount !== page.event.waitlistedCount
      || this.data.attendedCount !== page.event.attendedCount
      || this.data.cancellationPendingCount !== page.event.cancellationPendingCount
      || this.data.rejectedCount !== page.event.rejectedCount
      || this.data.cancelledCount !== page.event.cancelledCount
      || this.data.totalCount !== page.event.totalCount
      || this.data.nextCursor !== page.nextCursor
      || (page.event.title || this.data.title) !== this.data.title

    if (!options.append && nextSig === this.presentationSig && !countsChanged && this.data.state === 'ready') {
      // Skip identical setData to avoid native image/list flash on Tab return / refresh.
      return
    }

    this.presentationSig = nextSig
    this.setData({
      state: 'ready',
      title: page.event.title || this.data.title,
      startsText: page.event.startsAt ? formatLocalDateTime(page.event.startsAt) : '',
      items,
      nextCursor: page.nextCursor,
      registrationCount: page.event.registrationCount,
      pendingReviewCount: page.event.pendingReviewCount,
      waitlistedCount: page.event.waitlistedCount,
      cancellationPendingCount: page.event.cancellationPendingCount,
      attendedCount: page.event.attendedCount,
      rejectedCount: page.event.rejectedCount,
      cancelledCount: page.event.cancelledCount,
      totalCount: page.event.totalCount,
      canViewSensitiveRoster: page.canViewSensitiveRoster,
      canExportRoster: page.canExportRoster,
      canReviewRegistration: page.canReviewRegistration,
      canCheckIn: page.canCheckIn,
      canUndoCheckIn: page.canUndoCheckIn,
      canOverrideCheckIn: page.canOverrideCheckIn,
      message: '',
    })
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.processingId) {
      return
    }
    const seq = this.loadMoreSeq + 1
    this.loadMoreSeq = seq
    this.loadingMoreSeq = seq
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await adminModule.listEventRegistrations(
        rosterQuery(
          this.data.eventId,
          this.data.status,
          this.data.activeQuery,
          this.data.nextCursor,
        ),
        { force: true },
      )
      if (seq !== this.loadMoreSeq) {
        return
      }
      this.applyPage(page, { append: true })
    }
    catch (error) {
      if (seq !== this.loadMoreSeq) {
        return
      }
      this.setData({
        message: error instanceof Error ? error.message : '加载更多失败',
      })
    }
    finally {
      // Release this generation's operation loading even when superseded by first-page reload.
      // A newer loadMore owns loadingMoreSeq and must not be cleared here.
      if (this.loadingMoreSeq === seq) {
        this.loadingMoreSeq = 0
        this.setData({ loadingMore: false })
      }
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadRoster(true, { reset: true })
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  patchLocalItem(result: { id: string, status: AdminRegistrationStatus, version: number, attendedAt: string | null }) {
    const items = this.data.items.map((item) => {
      if (item.id !== result.id) {
        return item
      }
      return {
        ...displayItem({
          ...item,
          status: result.status,
          version: result.version,
          attendedAt: result.attendedAt,
        }, ''),
      }
    })
    let attendedCount = this.data.attendedCount
    const registrationCount = this.data.registrationCount
    const previous = this.data.items.find(item => item.id === result.id)
    if (previous && previous.status !== result.status) {
      if (previous.status === 'REGISTERED' && result.status === 'ATTENDED') {
        attendedCount += 1
      }
      if (previous.status === 'ATTENDED' && result.status === 'REGISTERED') {
        attendedCount = Math.max(0, attendedCount - 1)
      }
    }
    this.presentationSig = presentationSignature(items)
    this.setData({ items, attendedCount, registrationCount })
  },

  async showConfirmModal(options: WechatMiniprogram.ShowModalOption) {
    if (this.confirmationBusy || this.data.processingId || this.data.undoing || this.data.exporting) {
      return { confirm: false, cancel: true } as WechatMiniprogram.ShowModalSuccessCallbackResult
    }
    this.confirmationBusy = true
    try {
      return await wx.showModal(options)
    }
    finally {
      this.confirmationBusy = false
    }
  },

  async approveRegistration(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processingId || this.data.undoing || this.data.exporting || this.confirmationBusy) {
      return
    }
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    const selected = this.data.items.find(item => item.id === registrationId)
    if (!selected || !['PENDING_REVIEW', 'WAITLISTED'].includes(selected.status)) {
      return
    }
    const modal = await this.showConfirmModal({
      title: selected.status === 'WAITLISTED' ? '确认候补补位' : '通过报名申请',
      content: selected.status === 'WAITLISTED'
        ? `如有空余名额，将让 ${selected.nickname} 正式报名。`
        : `确认通过 ${selected.nickname} 的报名申请？满员时会转入候补。`,
      confirmColor: '#235B43',
    })
    if (!modal.confirm) {
      return
    }
    await this.performReview(selected, 'approve', '')
  },

  openRejectDialog(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processingId || this.data.undoing || this.data.exporting || this.confirmationBusy) {
      return
    }
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    const selected = this.data.items.find(item => item.id === registrationId)
    if (!selected || !['PENDING_REVIEW', 'WAITLISTED'].includes(selected.status)) {
      return
    }
    this.setData({
      rejectDialogVisible: true,
      reviewRegistrationId: selected.id,
      reviewVersion: selected.version,
      reviewNickname: selected.nickname,
      reviewReason: '',
      message: '',
    })
  },

  closeRejectDialog() {
    if (this.data.processingId) {
      return
    }
    this.setData({
      rejectDialogVisible: false,
      reviewRegistrationId: '',
      reviewVersion: 0,
      reviewNickname: '',
      reviewReason: '',
    })
  },

  updateReviewReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ reviewReason: event.detail.value })
  },

  async confirmReject() {
    const selected = this.data.items.find(item => item.id === this.data.reviewRegistrationId)
    const reason = this.data.reviewReason.trim()
    if (!selected || this.data.processingId) {
      return
    }
    if (!reason) {
      this.setData({ message: '请填写未通过原因。' })
      return
    }
    await this.performReview(selected, 'reject', reason)
    if (!this.data.processingId) {
      this.setData({
        rejectDialogVisible: false,
        reviewRegistrationId: '',
        reviewVersion: 0,
        reviewNickname: '',
        reviewReason: '',
      })
    }
  },

  async performReview(
    selected: DisplayRosterItem,
    decision: 'approve' | 'reject',
    reason: string,
  ) {
    this.setData({ processingId: selected.id, message: '' })
    try {
      const result = await adminModule.reviewEventRegistration(
        this.data.eventId,
        selected.id,
        decision,
        selected.version,
        reason,
      )
      await this.loadRoster(true, { reset: true })
      this.setData({
        message: result.status === 'REGISTERED'
          ? '报名已通过。'
          : (result.status === 'WAITLISTED' ? '当前满员，成员已进入候补。' : '报名申请未通过。'),
      })
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({ processingId: '', message: '报名状态已变化，正在刷新名单。' })
        await this.loadRoster(true, { reset: true })
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '报名审核失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async checkIn(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processingId || this.data.undoing || this.data.exporting || this.confirmationBusy) {
      return
    }
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    const selected = this.data.items.find(item => item.id === registrationId)
    if (!selected || selected.status !== 'REGISTERED') {
      return
    }
    const modal = await this.showConfirmModal({
      title: '确认签到',
      content: `确认 ${selected.nickname} 已到场？`,
      confirmColor: '#235B43',
    })
    if (!modal.confirm) {
      return
    }
    await this.performCheckIn(selected, { allowOverride: false })
  },

  async scanCheckIn() {
    if (this.data.scanning || this.data.processingId || this.data.undoing || this.data.exporting) {
      return
    }
    this.setData({ scanning: true, message: '' })
    try {
      const scanned = await wx.scanCode({
        onlyFromCamera: true,
        scanType: ['qrCode'],
      })
      const value = String(scanned.result || '')
      if (!value.startsWith('mbr-checkin:v1:')) {
        throw new Error('这不是本活动系统的签到码')
      }
      const result = await adminModule.checkInByQr(value)
      if (result.eventId !== this.data.eventId) {
        throw new Error('该签到码不属于当前活动')
      }
      await this.loadRoster(true, { reset: true })
      wx.showToast({ title: result.idempotent ? '已签到' : '签到成功', icon: 'success' })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '扫码签到失败'
      if (!/cancel/i.test(message)) {
        this.setData({ message })
      }
    }
    finally {
      this.setData({ scanning: false })
    }
  },

  async performCheckIn(
    selected: DisplayRosterItem,
    options: { allowOverride: boolean },
  ) {
    const idempotencyKey = newIdempotencyKey()
    this.setData({ processingId: selected.id, message: '' })
    try {
      const result = await adminModule.checkInRegistration(
        this.data.eventId,
        selected.id,
        selected.version,
        {
          allowOverride: options.allowOverride,
          idempotencyKey,
        },
      )
      this.patchLocalItem(result)
      this.setData({
        message: result.idempotent
          ? '已签到（重复确认，未重复记账）'
          : (result.override ? '已覆盖签到窗口完成签到' : '签到成功'),
      })
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        // Clear latch before refresh so UI cannot remain stuck on processing.
        this.setData({ processingId: '', message: '报名状态已变化，正在刷新名单。' })
        await this.loadRoster(true, { reset: true })
        return
      }
      if (error instanceof AdminGatewayError && error.code === 'CHECKIN_WINDOW_CLOSED') {
        if (!options.allowOverride && this.data.canOverrideCheckIn) {
          // Clear busy before secondary modal so confirmation latch can open.
          this.setData({ processingId: '' })
          const overrideModal = await this.showConfirmModal({
            title: '不在签到时间窗口',
            content: '当前不在签到时间窗口。负责人可确认后覆盖一次，仅本次生效。',
            confirmText: '覆盖签到',
            confirmColor: '#B45309',
          })
          if (overrideModal.confirm) {
            // Only owner capability path reaches allowOverride:true for a single retry.
            await this.performCheckIn(selected, { allowOverride: true })
            return
          }
          this.setData({ message: '已取消覆盖签到。' })
          return
        }
        this.setData({ message: '当前不在签到时间窗口。如需覆盖，请联系负责人。' })
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '签到失败' })
    }
    finally {
      if (this.data.processingId === selected.id) {
        this.setData({ processingId: '' })
      }
    }
  },

  openUndoDialog(event: WechatMiniprogram.TouchEvent) {
    if (this.data.processingId || this.data.undoing || this.data.exporting || this.confirmationBusy) {
      return
    }
    const registrationId = String(event.currentTarget.dataset.registrationId || '')
    const selected = this.data.items.find(item => item.id === registrationId)
    if (!selected || selected.status !== 'ATTENDED') {
      return
    }
    this.setData({
      undoDialogVisible: true,
      undoRegistrationId: selected.id,
      undoVersion: selected.version,
      undoNickname: selected.nickname,
      undoCategory: 'MISTAP',
      undoReasonText: '',
      message: '',
    })
  },

  closeUndoDialog() {
    if (this.data.undoing) {
      return
    }
    this.setData({
      undoDialogVisible: false,
      undoRegistrationId: '',
      undoVersion: 0,
      undoNickname: '',
      undoCategory: 'MISTAP',
      undoReasonText: '',
    })
  },

  selectUndoCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category || 'OTHER')
    this.setData({ undoCategory: category })
  },

  updateUndoReasonText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ undoReasonText: event.detail.value })
  },

  async confirmUndo() {
    if (this.data.undoing || !this.data.undoRegistrationId || this.confirmationBusy) {
      return
    }
    const category = this.data.undoCategory
    if (!UNDO_CATEGORIES.some(item => item.value === category)) {
      this.setData({ message: '请选择撤销原因类别' })
      return
    }
    const text = this.data.undoReasonText.trim()
    if (text.length > 120) {
      this.setData({ message: '补充说明不能超过 120 个字符' })
      return
    }
    const idempotencyKey = newIdempotencyKey()
    this.setData({ undoing: true, processingId: this.data.undoRegistrationId, message: '' })
    try {
      const result = await adminModule.undoCheckIn(
        this.data.eventId,
        this.data.undoRegistrationId,
        this.data.undoVersion,
        { category, text },
        { idempotencyKey },
      )
      this.patchLocalItem(result)
      this.setData({
        undoDialogVisible: false,
        undoRegistrationId: '',
        undoVersion: 0,
        undoNickname: '',
        undoCategory: 'MISTAP',
        undoReasonText: '',
        message: '已撤销签到',
      })
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        // Clear latch and close dialog before refresh so processing cannot stick.
        this.setData({
          undoing: false,
          processingId: '',
          undoDialogVisible: false,
          message: '报名状态已变化，正在刷新名单。',
        })
        await this.loadRoster(true, { reset: true })
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '撤销失败' })
    }
    finally {
      this.setData({ undoing: false, processingId: '' })
    }
  },

  async exportRoster() {
    if (!this.data.canExportRoster
      || this.data.exporting
      || this.data.processingId
      || this.confirmationBusy) {
      return
    }
    const modal = await this.showConfirmModal({
      title: '导出报名名单',
      content: '文件包含报名者联系电话，仅限本次活动联系与现场服务使用，请妥善保管并及时删除。',
      confirmText: '确认导出',
      confirmColor: '#235B43',
    })
    if (!modal.confirm) {
      return
    }
    this.setData({ exporting: true, message: '' })
    try {
      const created = await adminModule.createRosterExport({
        eventId: this.data.eventId,
        status: this.data.status,
        query: this.data.activeQuery,
      })
      const downloaded = await adminModule.downloadRosterExport(
        this.data.eventId,
        created.downloadToken,
      )
      const fs = wx.getFileSystemManager()
      const filePath = `${wx.env.USER_DATA_PATH}/${downloaded.fileName}`
      await new Promise<void>((resolve, reject) => {
        fs.writeFile({
          filePath,
          data: downloaded.contentBase64,
          encoding: 'base64',
          success: () => resolve(),
          fail: error => reject(error),
        })
      })
      await new Promise<void>((resolve, reject) => {
        wx.openDocument({
          filePath,
          showMenu: true,
          fileType: 'xlsx',
          success: () => resolve(),
          fail: error => reject(error),
        })
      })
      this.setData({
        message: `已导出 ${created.rowCount} 条含联系电话的名单（${created.fileName}）`,
      })
    }
    catch (error) {
      if (error instanceof AdminGatewayError && error.code === 'EXPORT_STORAGE_NOT_CONFIGURED') {
        this.setData({ message: '导出存储尚未配置，当前环境不可导出。' })
        return
      }
      if (error instanceof AdminGatewayError && error.code === 'EXPORT_TOO_LARGE') {
        this.setData({ message: '导出名额超过 5000 条上限，请缩小筛选范围后重试。' })
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '导出失败' })
    }
    finally {
      this.setData({ exporting: false })
    }
  },
})
