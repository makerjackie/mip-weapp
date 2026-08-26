import type { AdminGrowthLevel, AdminGrowthLevelTransition, AdminUser } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { mipAdminModule } from '../../../modules/mip-admin'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type TransitionView = AdminGrowthLevelTransition & { createdText: string, directionText: string }

function dateBoundary(value: string, endOfDay: boolean) {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some(part => !Number.isInteger(part))) {
    return ''
  }
  const date = new Date(parts[0], parts[1] - 1, parts[2], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function transitionView(item: AdminGrowthLevelTransition): TransitionView {
  return {
    ...item,
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '—',
    directionText: item.toLevel && item.fromLevel ? `${item.fromLevel.name} → ${item.toLevel.name}` : item.toLevel ? `未定级 → ${item.toLevel.name}` : `${item.fromLevel?.name || '已定级'} → 未定级`,
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    items: [] as TransitionView[],
    levels: [] as AdminGrowthLevel[],
    levelChoices: [] as Array<{ id: string, name: string }>,
    candidates: [] as AdminUser[],
    query: '',
    selectedUserId: '',
    selectedUserName: '',
    fromLevelId: '',
    fromLevelIndex: 0,
    toLevelId: '',
    toLevelIndex: 0,
    createdFromDate: '',
    createdToDate: '',
    message: '',
    nextCursor: null as string | null,
    loadingMore: false,
  },
  onLoad(options: { userId?: string }) {
    if (options?.userId) {
      this.setData({ selectedUserId: String(options.userId) })
    }
  },
  onShow() { void this.load() },
  async load(force = false) {
    const hasContent = this.data.items.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [response, levels] = await Promise.all([
        mipAdminModule.growth.listLevelTransitions({ filters: this.filters() }, force),
        this.data.levels.length ? Promise.resolve({ items: this.data.levels }) : mipAdminModule.growth.listLevels(force),
      ])
      this.setData({ state: 'ready', items: response.items.map(transitionView), levels: levels.items, levelChoices: [{ id: '', name: '不限' }, ...levels.items], nextCursor: response.nextCursor || null, loadingMore: false, message: '' })
    }
    catch (error) { this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '等级变更记录加载失败' })) }
  },
  filters() {
    return {
      userId: this.data.selectedUserId,
      fromLevelId: this.data.fromLevelId,
      toLevelId: this.data.toLevelId,
      createdFrom: this.data.createdFromDate ? dateBoundary(this.data.createdFromDate, false) : '',
      createdTo: this.data.createdToDate ? dateBoundary(this.data.createdToDate, true) : '',
    }
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.state !== 'ready') {
      return
    }
    this.setData({ loadingMore: true })
    try {
      const response = await mipAdminModule.growth.listLevelTransitions({ cursor: this.data.nextCursor, filters: this.filters() })
      this.setData({ items: this.data.items.concat(response.items.map(transitionView)), nextCursor: response.nextCursor || null })
    }
    catch (error) { this.setData({ message: error instanceof Error ? error.message : '更多记录加载失败' }) }
    finally { this.setData({ loadingMore: false }) }
  },
  onReachBottom() { void this.loadMore() },
  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  async searchUsers() {
    const query = this.data.query.trim()
    if (!query) {
      return this.setData({ candidates: [] })
    }
    try {
      const response = await mipAdminModule.listUsers({ includePhone: false, filters: { query } }, true)
      this.setData({ candidates: response.items })
    }
    catch (error) { this.setData({ message: error instanceof Error ? error.message : '用户搜索失败' }) }
  },
  chooseUser(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedUserId: String(event.currentTarget.dataset.id || ''), selectedUserName: String(event.currentTarget.dataset.name || ''), candidates: [] })
    void this.load(true)
  },
  chooseLevel(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const index = Number(event.detail.value)
    const level = this.data.levelChoices[index]
    if (field === 'from') {
      this.setData({ fromLevelIndex: index, fromLevelId: level?.id || '' })
    }
    if (field === 'to') {
      this.setData({ toLevelIndex: index, toLevelId: level?.id || '' })
    }
  },
  changeDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'createdFromDate' || field === 'createdToDate') {
      this.setData({ [field]: event.detail.value })
    }
  },
  applyFilters() { void this.load(true) },
})
