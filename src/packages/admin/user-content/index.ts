import type {
  AdminCooperationCardDetail,
  AdminUserContentDetail,
  AdminUserContentKind,
  AdminUserContentListItem,
  AdminUserContentStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../config/mip-catalogs'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import {
  adminLoadFailure,
  isAdminForbiddenError,
  isAdminVersionConflict,
} from '../shared/page-state'

type KindFilter = AdminUserContentKind | 'ALL'
type StatusFilter = AdminUserContentStatus | 'ALL'

type ContentView = AdminUserContentListItem & {
  kindText: string
  roleText: string
  statusText: string
  safetyText: string
  publishedText: string
  updatedText: string
}

type DetailView = AdminUserContentDetail & {
  kindText: string
  statusText: string
  safetyText: string
  publishedText: string
  updatedText: string
  roleText: string
  roleFieldViews: Array<{ key: string, label: string, value: string }>
  abilityViews: Array<{ key: string, label: string, score: number }>
  historyViews: Array<{ action: 'UNPUBLISH', actorNickname: string, reason: string, createdAt: string, createdText: string }>
}

const kindOptions: Array<{ label: string, value: KindFilter }> = [
  { label: '全部内容', value: 'ALL' },
  { label: '合作卡', value: 'COOPERATION_CARD' },
  { label: '超级案例', value: 'SUPER_CASE' },
]
const statusOptions: Array<{ label: string, value: StatusFilter }> = [
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已下架', value: 'UNPUBLISHED' },
  { label: '已归档', value: 'ARCHIVED' },
  { label: '全部状态', value: 'ALL' },
]
const statusLabels: Record<AdminUserContentStatus, string> = {
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下架',
  ARCHIVED: '已归档',
}
const safetyLabels = {
  PENDING: '待检查',
  APPROVED: '已通过',
  REJECTED: '未通过',
  ERROR: '检查异常',
} as const

function roleName(roleKey: string | null) {
  if (!roleKey) {
    return ''
  }
  return cooperationRoles.find(item => item.key === roleKey)?.name || roleKey
}

function listView(item: AdminUserContentListItem): ContentView {
  return {
    ...item,
    kindText: item.kind === 'COOPERATION_CARD' ? '合作卡' : '超级案例',
    roleText: roleName(item.roleKey),
    statusText: statusLabels[item.status],
    safetyText: safetyLabels[item.contentSafetyStatus],
    publishedText: formatLocalDateTime(item.publishedAt),
    updatedText: formatLocalDateTime(item.updatedAt),
  }
}

function fieldValue(card: AdminCooperationCardDetail, key: string) {
  const value = card.roleFields[key]
  return Array.isArray(value) ? value.join('、') : String(value || '')
}

function detailView(item: AdminUserContentDetail): DetailView {
  const card = item.kind === 'COOPERATION_CARD' ? item : null
  const definition = card
    ? cooperationRoles.find(role => role.key === card.roleKey)
    : null
  return {
    ...item,
    kindText: item.kind === 'COOPERATION_CARD' ? '合作卡' : '超级案例',
    statusText: statusLabels[item.status],
    safetyText: safetyLabels[item.contentSafetyStatus],
    publishedText: formatLocalDateTime(item.publishedAt),
    updatedText: formatLocalDateTime(item.updatedAt),
    roleText: card ? roleName(card.roleKey) : '',
    roleFieldViews: card
      ? (definition?.fields || []).map(field => ({
          key: field.key,
          label: field.label,
          value: fieldValue(card, field.key),
        })).filter(field => field.value)
      : [],
    abilityViews: card
      ? cooperationAbilityDimensions.map(dimension => ({
          ...dimension,
          score: Number(card.abilityScores[dimension.key] || 0),
        }))
      : [],
    historyViews: item.moderationHistory.map(entry => ({
      ...entry,
      createdText: formatLocalDateTime(entry.createdAt),
    })),
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    items: [] as ContentView[],
    kindOptions,
    kindIndex: 0,
    statusOptions,
    statusIndex: 0,
    query: '',
    ownerUserId: '',
    nextCursor: null as string | null,
    loadingMore: false,
    canManage: false,
    detailOpen: false,
    detailState: 'loading' as AdminPageState,
    detail: null as DetailView | null,
    selectedContentId: '',
    selectedContentKind: '' as AdminUserContentKind | '',
    detailMessage: '',
    reason: '',
    processing: false,
    message: '',
  },
  initialContentId: '',
  initialContentKind: '' as AdminUserContentKind | '',
  loaded: false,
  listRequestSeq: 0,
  detailRequestSeq: 0,

  onLoad(options: Record<string, string | undefined>) {
    const ownerUserId = String(options.ownerUserId || '')
    const kind = options.kind === 'COOPERATION_CARD' || options.kind === 'SUPER_CASE'
      ? options.kind
      : ''
    this.initialContentId = String(options.contentId || '')
    this.initialContentKind = kind
    this.setData({
      ownerUserId,
      kindIndex: kindOptions.findIndex(item => item.value === kind) >= 0
        ? kindOptions.findIndex(item => item.value === kind)
        : 0,
    })
  },

  onShow() {
    if (!this.loaded) {
      this.loaded = true
      void this.loadContent(true)
    }
  },

  onUnload() {
    this.listRequestSeq += 1
    this.detailRequestSeq += 1
  },

  async onPullDownRefresh() {
    try {
      await this.loadContent(true)
      if (this.data.detailOpen && this.data.detail) {
        await this.loadDetail(this.data.detail.kind, this.data.detail.id, true)
      }
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ query: event.detail.value })
  },

  changeKind(event: WechatMiniprogram.PickerChange) {
    this.setData({ kindIndex: Number(event.detail.value) || 0 })
    void this.loadContent(true)
  },

  changeStatus(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) || 0 })
    void this.loadContent(true)
  },

  search() {
    void this.loadContent(true)
  },

  retryLoad() {
    void this.loadContent(true)
  },

  async loadContent(reset = true) {
    const seq = this.listRequestSeq + 1
    this.listRequestSeq = seq
    const hasContent = this.data.items.length > 0
    if (reset && !hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.governance.getSession(reset)
      if (seq !== this.listRequestSeq) {
        return
      }
      if (!hasCapability(session.capabilities, 'userContent.moderate')) {
        this.setData({ state: 'forbidden', canManage: false, items: [], message: '' })
        return
      }
      const kind = kindOptions[this.data.kindIndex]?.value || 'ALL'
      const status = statusOptions[this.data.statusIndex]?.value || 'PUBLISHED'
      const page = await mipAdminModule.userContent.list({
        kind,
        status,
        query: this.data.query.trim(),
        ownerUserId: this.data.ownerUserId || undefined,
        cursor: reset ? undefined : this.data.nextCursor || undefined,
        limit: 30,
      }, reset)
      if (seq !== this.listRequestSeq) {
        return
      }
      const nextItems = page.items.map(listView)
      this.setData({
        state: 'ready',
        canManage: true,
        items: reset ? nextItems : [...this.data.items, ...nextItems],
        nextCursor: page.nextCursor,
        message: '',
      })
      if (reset && this.initialContentId && this.initialContentKind) {
        const contentId = this.initialContentId
        const contentKind = this.initialContentKind
        this.initialContentId = ''
        this.initialContentKind = ''
        void this.loadDetail(contentKind, contentId, true)
      }
    }
    catch (error) {
      if (seq !== this.listRequestSeq) {
        return
      }
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', canManage: false, items: [], message: '' })
        return
      }
      this.setData(adminLoadFailure(error, {
        hasContent,
        fallbackMessage: '用户内容加载失败',
      }))
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true })
    try {
      await this.loadContent(false)
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    const kind = String(event.currentTarget.dataset.kind || '') as AdminUserContentKind
    if (!id || !['COOPERATION_CARD', 'SUPER_CASE'].includes(kind)) {
      return
    }
    void this.loadDetail(kind, id, false)
  },

  async loadDetail(kind: AdminUserContentKind, contentId: string, force: boolean) {
    const seq = this.detailRequestSeq + 1
    this.detailRequestSeq = seq
    this.setData({
      detailOpen: true,
      detailState: 'loading',
      detail: null,
      selectedContentId: contentId,
      selectedContentKind: kind,
      detailMessage: '',
      reason: '',
    })
    try {
      const detail = await mipAdminModule.userContent.get(kind, contentId, force)
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      this.setData({ detail: detailView(detail), detailState: 'ready', detailMessage: '' })
    }
    catch (error) {
      if (!this.data.detailOpen || seq !== this.detailRequestSeq) {
        return
      }
      this.setData({
        detailState: isAdminForbiddenError(error) ? 'forbidden' : 'error',
        detailMessage: error instanceof Error ? error.message : '用户内容详情加载失败',
      })
    }
  },

  retryDetail() {
    const kind = this.data.selectedContentKind
    const contentId = this.data.selectedContentId
    if (kind && contentId) {
      void this.loadDetail(kind, contentId, true)
    }
  },

  closeDetail() {
    if (this.data.processing) {
      return
    }
    this.detailRequestSeq += 1
    this.setData({
      detailOpen: false,
      detail: null,
      selectedContentId: '',
      selectedContentKind: '',
      detailMessage: '',
      reason: '',
    })
  },

  handleDetailVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeDetail()
    }
  },

  updateReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ reason: event.detail.value, detailMessage: '' })
  },

  async unpublish() {
    const detail = this.data.detail
    const reason = this.data.reason.normalize('NFKC').trim().replace(/\s+/g, ' ')
    if (!detail || detail.status !== 'PUBLISHED' || this.data.processing) {
      return
    }
    if (!reason || reason.length > 300) {
      this.setData({ detailMessage: '请填写不超过 300 字的下架原因。' })
      return
    }
    const confirmation = await wx.showModal({
      title: '下架用户内容',
      content: '下架后内容不再公开。用户再次发布时仍需通过内容安全检查。',
      confirmText: '确认下架',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      return
    }

    this.setData({ processing: true, detailMessage: '' })
    try {
      await mipAdminModule.userContent.unpublish({
        kind: detail.kind,
        contentId: detail.id,
        expectedVersion: detail.version,
        reason,
      })
      wx.showToast({ title: '内容已下架', icon: 'success' })
      await Promise.all([
        this.loadContent(true),
        this.loadDetail(detail.kind, detail.id, true),
      ])
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        await this.loadDetail(detail.kind, detail.id, true)
        this.setData({ detailMessage: '内容状态已更新，请确认后重试。' })
      }
      else if (isAdminForbiddenError(error)) {
        this.setData({ detailState: 'forbidden', detailMessage: '当前账号没有用户内容治理权限。' })
      }
      else {
        this.setData({ detailMessage: error instanceof Error ? error.message : '内容下架失败' })
      }
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
