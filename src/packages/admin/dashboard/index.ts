import type {
  AdminBranch,
  AdminDashboardOverviewPeriodInput,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import type {
  AdminDashboardActivityView,
  AdminDashboardPeriodOption,
  AdminDashboardScopeOption,
} from './model'
import { mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure, isAdminForbiddenError } from '../shared/page-state'
import {
  buildDashboardScopeOptions,
  buildDashboardViewModel,
  canLoadDashboardBranchCatalog,
  customDashboardPeriod,
  dashboardPeriodOptions,
  dashboardShanghaiToday,
  emptyDashboardViewModel,
  initialDashboardScopeOptions,
  validateDashboardCustomPeriod,
} from './model'

Page({
  data: {
    state: 'loading' as AdminPageState,
    view: emptyDashboardViewModel,
    periodOptions: dashboardPeriodOptions,
    selectedPreset: 'THIS_MONTH' as AdminDashboardPeriodOption,
    successfulPeriod: { preset: 'THIS_MONTH' } as AdminDashboardOverviewPeriodInput,
    customEditorOpen: false,
    customStartDate: '',
    customEndDate: '',
    customMaxDate: dashboardShanghaiToday(),
    customError: '',
    scopeOptions: initialDashboardScopeOptions as AdminDashboardScopeOption[],
    scopeIndex: 0,
    selectedScopeKey: 'AUTHORIZED',
    successfulScopeKey: 'AUTHORIZED',
    scopeMessage: '',
    canRefreshBranches: false,
    activityDetailOpen: false,
    selectedActivity: null as AdminDashboardActivityView | null,
    webLoginOpen: false,
    webLoginCode: '',
    webLoginBusy: false,
    webLoginError: '',
    webLoginConfirmed: false,
    message: '',
  },
  requestSeq: 0,
  branchCatalog: [] as AdminBranch[],
  branchCatalogLoaded: false,
  branchCatalogAttempted: false,

  onShow() {
    this.setData({ customMaxDate: dashboardShanghaiToday() })
    void this.loadDashboard()
  },

  onUnload() {
    this.requestSeq += 1
  },

  async loadDashboard(
    force = false,
    periodOverride?: AdminDashboardOverviewPeriodInput,
    scopeKeyOverride?: string,
    refreshBranchCatalog = false,
  ) {
    const requestedPeriod = periodOverride || this.data.successfulPeriod
    const requestedScopeKey = scopeKeyOverride || this.data.successfulScopeKey
    const hasContent = this.data.state === 'ready'
    const seq = this.requestSeq + 1
    this.requestSeq = seq
    this.setData(hasContent ? { message: '' } : { state: 'loading', message: '' })
    try {
      const session = await mipAdminModule.getSession(force)
      if (seq !== this.requestSeq) {
        return
      }
      const grants = session.capabilities
      const canRefreshBranches = canLoadDashboardBranchCatalog(grants)
      let branchCatalog = this.branchCatalogLoaded ? this.branchCatalog : null
      let scopeMessage = ''
      const shouldLoadBranches = canRefreshBranches
        && (!this.branchCatalogAttempted || refreshBranchCatalog)
      if (shouldLoadBranches) {
        try {
          const response = await mipAdminModule.listBranches(force || refreshBranchCatalog)
          if (seq !== this.requestSeq) {
            return
          }
          this.branchCatalog = response.items
          this.branchCatalogLoaded = true
          this.branchCatalogAttempted = true
          branchCatalog = response.items
        }
        catch {
          if (seq !== this.requestSeq) {
            return
          }
          this.branchCatalogAttempted = true
          scopeMessage = this.branchCatalogLoaded
            ? '城市分会列表刷新失败，当前显示上次结果。'
            : '城市分会列表暂不可用，可继续查看授权或平台范围。'
        }
      }
      else if (!canRefreshBranches) {
        this.branchCatalog = []
        this.branchCatalogLoaded = false
        this.branchCatalogAttempted = false
        branchCatalog = null
      }
      const scopeOptions = buildDashboardScopeOptions(grants, branchCatalog)
      const requestedScopeIndex = scopeOptions.findIndex(item => item.key === requestedScopeKey)
      const scopeIndex = requestedScopeIndex >= 0 ? requestedScopeIndex : 0
      const selectedScope = scopeOptions[scopeIndex]
      const overview = await mipAdminModule.getDashboardOverview({
        period: requestedPeriod,
        scope: selectedScope.input,
      }, force)
      if (seq !== this.requestSeq) {
        return
      }
      this.setData({
        state: 'ready',
        view: buildDashboardViewModel(overview, grants),
        selectedPreset: requestedPeriod.preset,
        successfulPeriod: requestedPeriod,
        customEditorOpen: false,
        customError: '',
        scopeOptions,
        scopeIndex,
        selectedScopeKey: selectedScope.key,
        successfulScopeKey: selectedScope.key,
        scopeMessage,
        canRefreshBranches,
        message: '',
      })
    }
    catch (error) {
      if (seq !== this.requestSeq) {
        return
      }
      const accessRevoked = isAdminForbiddenError(error)
      const successfulScopeIndex = this.data.scopeOptions.findIndex(
        item => item.key === this.data.successfulScopeKey,
      )
      this.setData({
        ...adminLoadFailure(error, {
          hasContent: hasContent && !accessRevoked,
          fallbackMessage: '数据概览加载失败',
        }),
        selectedPreset: this.data.successfulPeriod.preset,
        selectedScopeKey: this.data.successfulScopeKey,
        scopeIndex: successfulScopeIndex >= 0 ? successfulScopeIndex : 0,
        ...(accessRevoked
          ? {
              view: emptyDashboardViewModel,
              scopeOptions: initialDashboardScopeOptions,
              scopeIndex: 0,
              selectedScopeKey: 'AUTHORIZED',
              successfulScopeKey: 'AUTHORIZED',
              scopeMessage: '',
              canRefreshBranches: false,
              activityDetailOpen: false,
              selectedActivity: null,
            }
          : {}),
      })
    }
  },

  changePeriod(event: WechatMiniprogram.TouchEvent) {
    const preset = String(event.currentTarget.dataset.preset || '') as AdminDashboardPeriodOption
    if (!dashboardPeriodOptions.some(item => item.key === preset)) {
      return
    }
    if (preset === 'CUSTOM') {
      this.setData({
        selectedPreset: preset,
        customEditorOpen: true,
        customError: '',
      })
      return
    }
    if (preset === this.data.selectedPreset && !this.data.customEditorOpen) {
      return
    }
    this.setData({ selectedPreset: preset, customEditorOpen: false, customError: '' })
    void this.loadDashboard(true, { preset }, this.data.successfulScopeKey)
  },

  changeCustomDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'customStartDate' || field === 'customEndDate') {
      this.setData({ [field]: event.detail.value, customError: '' })
    }
  },

  async applyCustomPeriod() {
    const customError = validateDashboardCustomPeriod(
      this.data.customStartDate,
      this.data.customEndDate,
      this.data.customMaxDate,
    )
    if (customError) {
      this.setData({ customError })
      return
    }
    await this.loadDashboard(
      true,
      customDashboardPeriod(this.data.customStartDate, this.data.customEndDate),
      this.data.successfulScopeKey,
    )
  },

  async clearCustomPeriod() {
    this.setData({
      selectedPreset: 'THIS_MONTH',
      customEditorOpen: false,
      customStartDate: '',
      customEndDate: '',
      customError: '',
    })
    if (this.data.successfulPeriod.preset === 'THIS_MONTH') {
      return
    }
    await this.loadDashboard(
      true,
      { preset: 'THIS_MONTH' },
      this.data.successfulScopeKey,
    )
  },

  changeScope(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    const scopeIndex = Number(event.detail.value)
    const scope = this.data.scopeOptions[scopeIndex]
    if (!scope || scope.key === this.data.selectedScopeKey) {
      return
    }
    this.setData({ scopeIndex, selectedScopeKey: scope.key })
    void this.loadDashboard(true, this.data.successfulPeriod, scope.key)
  },

  retryScopeCatalog() {
    void this.loadDashboard(
      true,
      this.data.successfulPeriod,
      this.data.successfulScopeKey,
      true,
    )
  },

  retryDashboard() {
    void this.loadDashboard(
      true,
      this.data.successfulPeriod,
      this.data.successfulScopeKey,
      true,
    )
  },

  openActivity(event: WechatMiniprogram.TouchEvent) {
    const activity = this.data.view.activities.find(
      item => item.id === String(event.currentTarget.dataset.id || ''),
    )
    if (activity) {
      this.setData({ activityDetailOpen: true, selectedActivity: activity })
    }
  },

  closeActivity() {
    this.setData({ activityDetailOpen: false, selectedActivity: null })
  },

  openWebLogin() {
    this.setData({
      webLoginOpen: true,
      webLoginCode: '',
      webLoginBusy: false,
      webLoginError: '',
      webLoginConfirmed: false,
    })
  },

  closeWebLogin() {
    if (this.data.webLoginBusy) {
      return
    }
    this.setData({ webLoginOpen: false })
  },

  handleWebLoginVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeWebLogin()
    }
  },

  changeWebLoginCode(event: WechatMiniprogram.Input) {
    const webLoginCode = String(event.detail.value || '')
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, '')
      .slice(0, 8)
    this.setData({ webLoginCode, webLoginError: '', webLoginConfirmed: false })
  },

  async confirmWebLogin() {
    if (this.data.webLoginBusy) {
      return
    }
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(this.data.webLoginCode)) {
      this.setData({ webLoginError: '请输入网页显示的 8 位登录码。' })
      return
    }
    this.setData({ webLoginBusy: true, webLoginError: '', webLoginConfirmed: false })
    try {
      await mipAdminModule.confirmWebLogin(this.data.webLoginCode)
      this.setData({ webLoginBusy: false, webLoginConfirmed: true })
    }
    catch (error) {
      this.setData({
        webLoginBusy: false,
        webLoginError: error instanceof Error ? error.message : '网页登录确认失败，请重试。',
      })
    }
  },

  handleActivityVisibility(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
    if (!event.detail.visible) {
      this.closeActivity()
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadDashboard(
        true,
        this.data.successfulPeriod,
        this.data.successfulScopeKey,
        true,
      )
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  openPage(event: WechatMiniprogram.TouchEvent) {
    const path = String(event.currentTarget.dataset.path || '')
    if (path.startsWith('/packages/admin/')) {
      void wx.navigateTo({ url: path })
    }
  },
})
