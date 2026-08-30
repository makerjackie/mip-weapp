import type {
  AdminAnnouncement,
  AdminAnnouncementDraft,
  AdminAnnouncementSafetyStatus,
  AdminAnnouncementTargetType,
} from '../../../modules/mip-admin/announcements'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { leaveSecondaryPage } from '../../../modules/platform/case-navigation'
import { dateTimeParts, validateDateTimeRange } from '../components/date-time-range/model'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

interface TargetOption {
  id: string
  label: string
  scopeType: 'PLATFORM' | 'BRANCH' | 'EVENT'
  branchId: string | null
}

const safetyLabels: Record<AdminAnnouncementSafetyStatus, string> = {
  PENDING: '待检查',
  PASSED: '已通过',
  REJECTED: '未通过',
  ERROR: '检查失败',
}

function initialDraft(): AdminAnnouncementDraft {
  return {
    scopeType: 'PLATFORM',
    branchId: null,
    title: '',
    summary: '',
    body: '',
    targetType: null,
    targetId: null,
    visibleFrom: new Date().toISOString(),
    visibleUntil: null,
  }
}

const initial = initialDraft()
const initialStart = dateTimeParts(initial.visibleFrom)
const initialEnd = dateTimeParts(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

Page({
  data: {
    state: 'loading' as AdminPageState,
    announcementId: '',
    version: 0,
    status: 'DRAFT' as AdminAnnouncement['status'],
    safetyStatus: 'PENDING' as AdminAnnouncementSafetyStatus,
    safetyText: safetyLabels.PENDING,
    draft: initial,
    visibleFromDate: initialStart.date,
    visibleFromTime: initialStart.time,
    visibleUntilEnabled: false,
    visibleUntilDate: initialEnd.date,
    visibleUntilTime: initialEnd.time,
    platformAllowed: false,
    branches: [] as Array<{ id: string, name: string }>,
    branchIndex: -1,
    targetOptions: [] as TargetOption[],
    targetIndex: -1,
    targetLoading: false,
    editable: true,
    saving: false,
    message: '',
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(query: Record<string, string>) {
    const announcementId = query.announcementId || ''
    this.setData({ announcementId })
    void this.loadForm()
  },

  onHide() {
    this.clearNavigationTimer()
  },

  onUnload() {
    this.clearNavigationTimer()
  },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  retryLoad() {
    void this.loadForm(true)
  },

  async loadForm(force = false) {
    this.setData({ state: 'loading', message: '' })
    try {
      const [session, scopes, announcement] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.messaging.getAnnouncementScopes(force),
        this.data.announcementId
          ? mipAdminModule.messaging.getAnnouncement(this.data.announcementId, force)
          : Promise.resolve(null),
      ])
      if (!hasCapability(session.capabilities, 'announcements.manage')
        || (!scopes.platform && scopes.branches.length === 0)) {
        this.setData({ state: 'forbidden', message: '' })
        return
      }
      if (announcement) {
        this.applyAnnouncement(announcement, scopes.platform, scopes.branches)
      }
      else {
        const branch = scopes.platform ? null : scopes.branches[0] || null
        this.setData({
          'state': 'ready',
          'platformAllowed': scopes.platform,
          'branches': scopes.branches,
          'branchIndex': branch ? 0 : -1,
          'draft.scopeType': branch ? 'BRANCH' : 'PLATFORM',
          'draft.branchId': branch?.id || null,
          'message': '',
        })
      }
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '公告信息加载失败' }))
    }
  },

  applyAnnouncement(
    item: AdminAnnouncement,
    platformAllowed: boolean,
    branches: Array<{ id: string, name: string }>,
  ) {
    const start = dateTimeParts(item.visibleFrom)
    const end = dateTimeParts(item.visibleUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    this.setData({
      state: 'ready',
      version: item.version,
      status: item.status,
      safetyStatus: item.contentSafetyStatus,
      safetyText: safetyLabels[item.contentSafetyStatus],
      draft: {
        announcementId: item.id,
        expectedVersion: item.version,
        scopeType: item.scopeType,
        branchId: item.branchId,
        title: item.title,
        summary: item.summary,
        body: item.body || '',
        targetType: item.targetType,
        targetId: item.targetId,
        visibleFrom: item.visibleFrom,
        visibleUntil: item.visibleUntil,
      },
      visibleFromDate: start.date,
      visibleFromTime: start.time,
      visibleUntilEnabled: Boolean(item.visibleUntil),
      visibleUntilDate: end.date,
      visibleUntilTime: end.time,
      platformAllowed,
      branches,
      branchIndex: branches.findIndex(branch => branch.id === item.branchId),
      targetOptions: item.targetId
        ? [{
            id: item.targetId,
            label: item.targetType === 'EVENT' ? '当前关联活动' : '当前关联机会',
            scopeType: item.scopeType,
            branchId: item.branchId,
          }]
        : [],
      targetIndex: item.targetId ? 0 : -1,
      editable: item.status !== 'PUBLISHED',
      message: '',
    })
    if (item.targetType) {
      void this.loadTargets(item.targetType, true)
    }
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!this.data.editable || !['title', 'summary', 'body'].includes(field)) {
      return
    }
    this.setData({ [`draft.${field}`]: event.detail.value })
  },

  chooseScope(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const scopeType = String(event.currentTarget.dataset.scope || '')
    if (scopeType === 'PLATFORM' && this.data.platformAllowed) {
      this.setData({
        'draft.scopeType': 'PLATFORM',
        'draft.branchId': null,
        'branchIndex': -1,
        'draft.targetId': null,
        'targetIndex': -1,
      })
      return
    }
    if (scopeType === 'BRANCH' && this.data.branches.length) {
      const branchIndex = this.data.branchIndex >= 0 ? this.data.branchIndex : 0
      this.setData({
        'draft.scopeType': 'BRANCH',
        'draft.branchId': this.data.branches[branchIndex].id,
        branchIndex,
        'draft.targetId': null,
        'targetIndex': -1,
      })
    }
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: number | string }>) {
    if (!this.data.editable) {
      return
    }
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branches[branchIndex]
    if (branch) {
      this.setData({
        branchIndex,
        'draft.scopeType': 'BRANCH',
        'draft.branchId': branch.id,
        'draft.targetId': null,
        'targetIndex': -1,
      })
    }
  },

  chooseTargetType(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.editable) {
      return
    }
    const raw = String(event.currentTarget.dataset.type || '')
    const targetType = raw === 'EVENT' || raw === 'OPPORTUNITY' ? raw : null
    this.setData({
      'draft.targetType': targetType,
      'draft.targetId': null,
      'targetOptions': [],
      'targetIndex': -1,
      'message': '',
    })
    if (targetType) {
      void this.loadTargets(targetType, true)
    }
  },

  async loadTargets(targetType: AdminAnnouncementTargetType, force = false) {
    this.setData({ targetLoading: true })
    try {
      const page = targetType === 'EVENT'
        ? await mipAdminModule.listEvents({}, force)
        : await mipAdminModule.listOpportunities({}, force)
      const currentId = this.data.draft.targetId
      const options = page.items
        .filter((item) => {
          if (this.data.draft.scopeType === 'PLATFORM') {
            return true
          }
          return item.scopeType === 'BRANCH' && item.branchId === this.data.draft.branchId
        })
        .map(item => ({
          id: item.id,
          label: item.title,
          scopeType: item.scopeType,
          branchId: item.branchId,
        }))
      const targetIndex = options.findIndex(item => item.id === currentId)
      this.setData({ targetOptions: options, targetIndex })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '关联内容加载失败' })
    }
    finally {
      this.setData({ targetLoading: false })
    }
  },

  changeTarget(event: WechatMiniprogram.CustomEvent<{ value: number | string }>) {
    if (!this.data.editable) {
      return
    }
    const targetIndex = Number(event.detail.value)
    const target = this.data.targetOptions[targetIndex]
    if (target) {
      this.setData({ targetIndex, 'draft.targetId': target.id })
    }
  },

  changeDateTimePart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (!this.data.editable) {
      return
    }
    const detail = event.detail as { field?: string, value?: string }
    const aliases: Record<string, string> = {
      startDate: 'visibleFromDate',
      startTime: 'visibleFromTime',
      endDate: 'visibleUntilDate',
      endTime: 'visibleUntilTime',
    }
    const rawField = String(detail.field || event.currentTarget.dataset.field || '')
    const field = aliases[rawField] || rawField
    if (['visibleFromDate', 'visibleFromTime', 'visibleUntilDate', 'visibleUntilTime'].includes(field)) {
      this.setData({ [field]: detail.value || event.detail.value })
    }
  },

  toggleVisibleUntil(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.editable) {
      const detail = event.detail as { enabled?: boolean, value?: boolean }
      this.setData({ visibleUntilEnabled: detail.enabled === true || detail.value === true })
    }
  },

  clearDateTimeRange(event: WechatMiniprogram.CustomEvent<{ scope?: 'range' | 'end' }>) {
    if (event.detail.scope === 'end') {
      this.setData({ visibleUntilEnabled: false, visibleUntilDate: '', visibleUntilTime: '' })
    }
  },

  async save() {
    if (!this.data.editable || this.data.saving) {
      return
    }
    const range = validateDateTimeRange({
      startDate: this.data.visibleFromDate,
      startTime: this.data.visibleFromTime,
      endDate: this.data.visibleUntilDate,
      endTime: this.data.visibleUntilTime,
    }, this.data.visibleUntilEnabled)
    if (!range.valid) {
      this.setData({ message: range.message })
      return
    }
    const visibleFrom = range.startAt
    const visibleUntil = this.data.visibleUntilEnabled ? range.endAt : null
    if (this.data.draft.targetType && !this.data.draft.targetId) {
      this.setData({ message: '请选择关联内容。' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const saved = await mipAdminModule.messaging.saveAnnouncement({
        ...(this.data.announcementId
          ? { announcementId: this.data.announcementId, expectedVersion: this.data.version }
          : {}),
        scopeType: this.data.draft.scopeType,
        branchId: this.data.draft.branchId,
        title: this.data.draft.title,
        summary: this.data.draft.summary,
        body: this.data.draft.body,
        targetType: this.data.draft.targetType,
        targetId: this.data.draft.targetId,
        visibleFrom,
        visibleUntil,
      })
      this.setData({ announcementId: saved.id, version: saved.version })
      wx.showToast({ title: '草稿已保存', icon: 'success' })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        leaveSecondaryPage('/packages/admin/announcements/index')
      }, 500)
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({ state: 'conflict', message: '公告内容已更新，请重新加载后再编辑。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '公告保存失败' })
      }
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
