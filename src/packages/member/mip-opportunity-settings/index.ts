import type { MatchingPreferences } from '../../../modules/mip-opportunities'
import { opportunityModule } from '../../../modules/mip-opportunities'

type PageState = 'loading' | 'ready' | 'error'

Page({
  data: {
    state: 'loading' as PageState,
    preferences: null as MatchingPreferences | null,
    saving: false,
    message: '',
  },

  onLoad() {
    void this.load()
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      this.setData({ state: 'ready', preferences: await opportunityModule.getMatchingPreferences() })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '权限设置加载失败' })
    }
  },

  toggle(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const path = String(event.currentTarget.dataset.path || '')
    const preferences = this.data.preferences
    if (!preferences) {
      return
    }
    const value = Boolean(event.detail.value)
    const next = {
      notifications: { ...preferences.notifications },
      opportunities: { ...preferences.opportunities },
    }
    if (path.startsWith('notifications.')) {
      ;(next.notifications as unknown as Record<string, unknown>)[path.slice(14)] = value
    }
    else if (path.startsWith('opportunities.')) {
      ;(next.opportunities as unknown as Record<string, unknown>)[path.slice(14)] = value
    }
    this.setData({ preferences: next })
  },

  setScope(event: WechatMiniprogram.TouchEvent) {
    const scope = String(event.currentTarget.dataset.scope || '') as 'PLATFORM' | 'PRIMARY_BRANCH'
    const preferences = this.data.preferences
    if (!preferences || !['PLATFORM', 'PRIMARY_BRANCH'].includes(scope)) {
      return
    }
    this.setData({ preferences: {
      ...preferences,
      opportunities: { ...preferences.opportunities, matchingScope: scope },
    } })
  },

  async save() {
    const preferences = this.data.preferences
    if (!preferences || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await opportunityModule.saveMatchingPreferences({
        commentsEnabled: preferences.notifications.commentsEnabled,
        opportunityMatchingNotificationsEnabled: preferences.notifications.opportunityMatchingEnabled,
        hotspotsEnabled: preferences.notifications.hotspotsEnabled,
        matchingEnabled: preferences.opportunities.matchingEnabled,
        talentRecommendationsEnabled: preferences.opportunities.talentRecommendationsEnabled,
        projectRecommendationsEnabled: preferences.opportunities.projectRecommendationsEnabled,
        discoverableForMatching: preferences.opportunities.discoverableForMatching,
        matchingScope: preferences.opportunities.matchingScope,
        notificationVersion: preferences.notifications.version,
        opportunityVersion: preferences.opportunities.version,
      })
      this.setData({ preferences: result })
      wx.showToast({ title: '设置已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '设置保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
