import type { AdminGrowthRule } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { growthAdminActionFailure } from '../growth-entries/action-state'
import { adminLoadFailure } from '../shared/page-state'

interface GrowthRuleView extends AdminGrowthRule {
  metricLabel: string
  statusLabel: string
  statusTheme: 'default' | 'success' | 'warning'
  sourceLabel: string
}

const metricLabels: Record<AdminGrowthRule['metric'], string> = {
  EXPERIENCE: '经验值',
  CONTRIBUTION: '贡献值',
}

const statusLabels: Record<AdminGrowthRule['status'], string> = {
  DRAFT: '草稿',
  ACTIVE: '启用',
  INACTIVE: '停用',
}

const statusThemes: Record<AdminGrowthRule['status'], GrowthRuleView['statusTheme']> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'default',
}

const sourceLabels: Record<string, string> = {
  'identity.profile_completed': '完善资料',
  'event.checked_in': '完成活动签到',
  'referral.confirmed': '确认有效引荐',
  'super_case.published': '发布超级案例',
}

function toView(rule: AdminGrowthRule): GrowthRuleView {
  return {
    ...rule,
    metricLabel: metricLabels[rule.metric],
    statusLabel: statusLabels[rule.status],
    statusTheme: statusThemes[rule.status],
    sourceLabel: sourceLabels[rule.sourceEventType] || '其他业务行为',
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    rules: [] as GrowthRuleView[],
    canConfigure: false,
    editorId: '',
    editorVersion: 0,
    ruleKey: '',
    name: '',
    metric: 'EXPERIENCE',
    deltaValue: '',
    dailyLimitValue: '',
    sourceEventType: '',
    sourceLabel: '',
    status: 'DRAFT',
    saving: false,
    message: '',
  },
  onShow() { void this.loadRules() },
  async loadRules(force = false) {
    const hasContent = this.data.rules.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, response] = await Promise.all([mipAdminModule.getSession(force), mipAdminModule.growth.listRules(force)])
      this.setData({
        state: 'ready',
        rules: response.items.map(toView),
        canConfigure: hasCapability(session.capabilities, 'growth.configure'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '奖励规则加载失败' }))
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['deltaValue', 'dailyLimitValue'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    this.setData({ status: String(event.currentTarget.dataset.value || 'DRAFT') })
  },
  edit(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canConfigure) {
      return
    }
    const rule = this.data.rules.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!rule) {
      return
    }
    this.setData({ editorId: rule.id, editorVersion: rule.version, ruleKey: rule.ruleKey, name: rule.name, metric: rule.metric, deltaValue: String(rule.deltaValue), dailyLimitValue: rule.dailyLimitValue === null ? '' : String(rule.dailyLimitValue), sourceEventType: rule.sourceEventType, sourceLabel: rule.sourceLabel, status: rule.status })
  },
  resetEditor() {
    this.setData({
      editorId: '',
      editorVersion: 0,
      ruleKey: '',
      name: '',
      metric: 'EXPERIENCE',
      deltaValue: '',
      dailyLimitValue: '',
      sourceEventType: '',
      sourceLabel: '',
      status: 'DRAFT',
      message: '',
    })
  },
  async save() {
    if (!this.data.canConfigure || !this.data.editorId || this.data.saving) {
      return
    }
    const deltaValue = Number(this.data.deltaValue)
    const dailyLimitValue = this.data.dailyLimitValue ? Number(this.data.dailyLimitValue) : null
    if (!Number.isInteger(deltaValue) || deltaValue < 1
      || (dailyLimitValue !== null && (!Number.isInteger(dailyLimitValue) || dailyLimitValue < 0))) {
      this.setData({ message: '请填写有效的奖励数值和每日上限。' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.growth.saveRule({
        ruleId: this.data.editorId || undefined,
        expectedVersion: this.data.editorVersion || undefined,
        draft: { ruleKey: this.data.ruleKey.trim(), name: this.data.name.trim(), metric: this.data.metric, deltaValue, dailyLimitValue, sourceEventType: this.data.sourceEventType.trim(), status: this.data.status },
      })
      wx.showToast({ title: '规则已保存', icon: 'success' })
      this.resetEditor()
      await this.loadRules(true)
    }
    catch (error) {
      this.setData(growthAdminActionFailure(error, '规则保存失败'))
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
