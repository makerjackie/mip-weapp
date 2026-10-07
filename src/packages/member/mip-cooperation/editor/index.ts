import type { CooperationCardId, CooperationRoleKey } from '../../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../../modules/mip-ai'
import type {
  CooperationCardDetail,
  CooperationRoleFieldValue,
} from '../../../../modules/mip-cooperation'
import {
  cooperationAbilityDimensions,
  cooperationGoalFields,
  cooperationRoles,
} from '../../../../config/mip-catalogs'
import { aiObject, aiText } from '../../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { cooperationModule, normalizeCooperationCircles, normalizeCooperationQuirks } from '../../../../modules/mip-cooperation'

interface RoleOption { key: CooperationRoleKey, name: string }
interface AbilityView { key: string, label: string, score: number }
interface GoalView { key: string, label: string, placeholder: string, value: string }
interface MenuFieldView { key: string, label: string, placeholder: string, input: string, value: string }
interface CircleView { name: string, identity: string, years: string, trait: string }
interface QuirkView { external: string, internal: string, advice: string }

const MAX_ABILITY_SCORE = 5

function emptyCircle(): CircleView {
  return { name: '', identity: '', years: '', trait: '' }
}

function emptyQuirk(): QuirkView {
  return { external: '', internal: '', advice: '' }
}

function aiFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean).slice(0, 12).join('、').slice(0, 1000)
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, 1000)
    : ''
}

function aiScore(value: unknown, fallback: number) {
  const score = Number(value)
  return Number.isFinite(score) ? Math.min(MAX_ABILITY_SCORE, Math.max(0, Math.round(score))) : fallback
}

function circleViews(value: CooperationRoleFieldValue | undefined): CircleView[] {
  const entries = normalizeCooperationCircles(value)
  const rows = (Array.isArray(entries) ? entries : []) as Array<Record<string, string>>
  return rows.map(row => ({
    name: String(row.name ?? ''),
    identity: String(row.identity ?? ''),
    years: String(row.years ?? ''),
    trait: String(row.trait ?? ''),
  }))
}

function quirkViews(value: CooperationRoleFieldValue | undefined): QuirkView[] {
  const entries = normalizeCooperationQuirks(value)
  const rows = (Array.isArray(entries) ? entries : []) as Array<Record<string, string>>
  return rows.map(row => ({
    external: String(row.external ?? ''),
    internal: String(row.internal ?? ''),
    advice: String(row.advice ?? ''),
  }))
}

Page({
  data: {
    id: '' as CooperationCardId | '',
    version: 0,
    state: 'loading' as 'loading' | 'ready' | 'error',
    saving: false,
    message: '',
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
    bannerText: '合作卡可以帮助您更好的发现商机',
    roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name })) as RoleOption[],
    roleIndex: 0,
    roleKey: 'connector' as CooperationRoleKey,
    roleLocked: false,
    positioning: '',
    abilities: [] as AbilityView[],
    goals: [] as GoalView[],
    menuTitle: '',
    menuStructured: 'circles' as '' | 'circles',
    menuFields: [] as MenuFieldView[],
    circles: [emptyCircle()] as CircleView[],
    quirks: [emptyQuirk()] as QuirkView[],
    legacyFields: {} as Record<string, CooperationRoleFieldValue>,
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  // 返回守卫状态：dirty=有未保存修改，alertArmed=已注册原生返回确认
  dirty: false,
  alertArmed: false,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({
      id: String(options.id || '') as CooperationCardId | '',
      aiDraftId: String(options.aiDraftId || ''),
    })
    void this.initialize()
  },

  onHide() {
    this.clearNavigationTimer()
  },

  // AI 语音填写入口(设计稿 AI助手卡):进入录音页,完成后带 aiDraftId 回跳。
  onAiAssistant() {
    if (this.data.id) {
      wx.showToast({ title: 'AI 语音填写仅用于新建合作卡', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/packages/member/mip-ai/voice/index?purpose=COOPERATION_CARD' })
  },

  onUnload() {
    this.clearNavigationTimer()
    // 原生返回确认的「确定」落到这里：未保存修改静默暂存为草稿（发布卡保持发布态，服务端只更新内容）
    if (this.data.state === 'ready' && this.dirty && !this.data.saving) {
      this.dirty = false
      void this.saveDraftOnExit()
    }
  },

  /** 用户改动任一字段后登记 dirty，并武装原生返回确认（确定=暂存并返回，取消=留下）。 */
  touch() {
    if (this.data.state !== 'ready') {
      return
    }
    this.dirty = true
    if (!this.alertArmed) {
      this.alertArmed = true
      wx.enableAlertBeforeUnload({ message: '合作卡尚未保存，返回将自动暂存为草稿' })
    }
  },

  markClean() {
    this.dirty = false
    if (this.alertArmed) {
      this.alertArmed = false
      wx.disableAlertBeforeUnload()
    }
  },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  async initialize() {
    this.setData({ state: 'loading', message: '' })
    try {
      if (this.data.id && this.data.aiDraftId) {
        throw new Error('AI 草稿不能覆盖已有合作卡')
      }
      const [detail, aiSource] = await Promise.all([
        this.data.id ? cooperationModule.get(this.data.id) : Promise.resolve(null),
        this.data.aiDraftId ? loadAiEditorDraft(this.data.aiDraftId, 'COOPERATION_CARD') : Promise.resolve(null),
      ])
      const aiRoleKey = aiText(aiSource?.fields || {}, 'roleKey', 64)
      const roleKey = detail?.roleKey
        || (cooperationRoles.some(item => item.key === aiRoleKey) ? aiRoleKey as CooperationRoleKey : this.data.roleKey)
      this.applyRole(roleKey, detail)
      if (aiSource) {
        this.applyAiDraft(aiSource.fields, aiSource.confirmation)
      }
      this.setData({ state: 'ready' })
      if (aiSource) {
        // AI 草稿覆盖了表单内容，视为未保存修改
        this.touch()
      }
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyRole(roleKey: CooperationRoleKey, detail: CooperationCardDetail | null) {
    const definition = cooperationRoles.find(role => role.key === roleKey) || cooperationRoles[0]
    const legacyFields: Record<string, CooperationRoleFieldValue> = {}
    for (const key of definition.legacyFieldKeys) {
      const value = detail?.roleFields[key]
      if (value !== undefined && value !== '') {
        legacyFields[key] = value
      }
    }
    const circles = circleViews(detail?.roleFields.circles)
    const quirks = quirkViews(detail?.roleFields.quirks)
    this.setData({
      roleKey: definition.key,
      roleIndex: Math.max(0, cooperationRoles.findIndex(role => role.key === definition.key)),
      roleLocked: Boolean(detail),
      positioning: detail?.positioning || definition.positioning,
      version: detail?.version || 0,
      abilities: cooperationAbilityDimensions.map((dimension, index) => ({
        key: dimension.key,
        label: definition.abilityLabels[index] || dimension.label,
        score: Number(detail?.abilityScores[dimension.key] ?? 3),
      })),
      goals: cooperationGoalFields.map(field => ({
        key: field.key,
        label: field.label,
        placeholder: field.placeholder,
        value: field.key === 'targetSummary'
          ? (detail?.targetSummary || '')
          : aiFieldValue(detail?.roleFields[field.key]),
      })),
      menuTitle: definition.menu.title,
      menuStructured: definition.menu.structured,
      menuFields: definition.menu.fields.map(field => ({
        key: field.key,
        label: field.label,
        placeholder: field.placeholder,
        input: field.input,
        value: aiFieldValue(detail?.roleFields[field.key]),
      })),
      circles: circles.length ? circles : [emptyCircle()],
      quirks: quirks.length ? quirks : [emptyQuirk()],
      legacyFields,
    })
  },

  applyAiDraft(fields: Record<string, unknown>, confirmation: AiDraftSourceConfirmation | null) {
    const roleFields = aiObject(fields, 'roleFields')
    const abilityScores = aiObject(fields, 'abilityScores')
    const circles = circleViews(roleFields.circles as CooperationRoleFieldValue)
    const quirks = quirkViews(roleFields.quirks as CooperationRoleFieldValue)
    this.setData({
      positioning: aiText(fields, 'positioning', 500) || this.data.positioning,
      goals: this.data.goals.map(goal => ({
        ...goal,
        value: goal.key === 'targetSummary'
          ? (aiText(fields, 'targetSummary', 500) || goal.value)
          : (aiFieldValue(roleFields[goal.key]) || goal.value),
      })),
      menuFields: this.data.menuFields.map(field => ({
        ...field,
        value: aiFieldValue(roleFields[field.key]) || field.value,
      })),
      ...(circles.length ? { circles } : {}),
      ...(quirks.length ? { quirks } : {}),
      abilities: this.data.abilities.map(item => ({
        ...item,
        score: aiScore(abilityScores[item.key], item.score),
      })),
      aiConfirmation: confirmation,
      aiDraftLoaded: true,
    })
  },

  changeRole(event: WechatMiniprogram.CustomEvent<{ key: CooperationRoleKey }>) {
    if (this.data.roleLocked || this.data.saving) {
      return
    }
    const key = String(event.currentTarget.dataset.key || '') as CooperationRoleKey
    if (key && key !== this.data.roleKey && cooperationRoles.some(role => role.key === key)) {
      this.applyRole(key, null)
      this.touch()
    }
  },

  updateGoal(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = String(event.currentTarget.dataset.key || '')
    if (!this.data.goals.some(goal => goal.key === key)) {
      return
    }
    this.touch()
    this.setData({ goals: this.data.goals.map(goal => goal.key === key ? { ...goal, value: event.detail.value } : goal) })
  },

  updateMenuField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = String(event.currentTarget.dataset.key || '')
    this.touch()
    this.setData({ menuFields: this.data.menuFields.map(item => item.key === key ? { ...item, value: event.detail.value } : item) })
  },

  updateAbility(event: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    const key = String(event.currentTarget.dataset.key || '')
    const score = Number(event.currentTarget.dataset.score)
    if (!Number.isInteger(score) || score < 1 || score > MAX_ABILITY_SCORE) {
      return
    }
    this.touch()
    this.setData({ abilities: this.data.abilities.map(item => item.key === key ? { ...item, score } : item) })
  },

  updateCircle(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const group = Number(event.currentTarget.dataset.group)
    const field = String(event.currentTarget.dataset.field || '') as keyof CircleView
    if (!Number.isInteger(group) || !['name', 'identity', 'years', 'trait'].includes(field)) {
      return
    }
    this.touch()
    this.setData({
      circles: this.data.circles.map((item, index) => index === group ? { ...item, [field]: event.detail.value } : item),
    })
  },

  addCircle() {
    if (this.data.circles.length >= 12) {
      return
    }
    this.touch()
    this.setData({ circles: [...this.data.circles, emptyCircle()] })
  },

  removeCircle(event: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    const group = Number(event.currentTarget.dataset.group)
    if (!Number.isInteger(group) || group <= 0 || this.data.circles.length <= 1) {
      return
    }
    this.touch()
    this.setData({ circles: this.data.circles.filter((_, index) => index !== group) })
  },

  updateQuirk(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const group = Number(event.currentTarget.dataset.group)
    const field = String(event.currentTarget.dataset.field || '') as keyof QuirkView
    if (!Number.isInteger(group) || !['external', 'internal', 'advice'].includes(field)) {
      return
    }
    this.touch()
    this.setData({
      quirks: this.data.quirks.map((item, index) => index === group ? { ...item, [field]: event.detail.value } : item),
    })
  },

  addQuirk() {
    if (this.data.quirks.length >= 12) {
      return
    }
    this.touch()
    this.setData({ quirks: [...this.data.quirks, emptyQuirk()] })
  },

  removeQuirk(event: WechatMiniprogram.CustomEvent<Record<string, unknown>>) {
    const group = Number(event.currentTarget.dataset.group)
    if (!Number.isInteger(group) || group <= 0 || this.data.quirks.length <= 1) {
      return
    }
    this.touch()
    this.setData({ quirks: this.data.quirks.filter((_, index) => index !== group) })
  },

  saveCard() { void this.save() },

  /** 组装保存载荷（保存按钮与返回暂存共用）。 */
  buildDraftPayload() {
    const definition = cooperationRoles.find(role => role.key === this.data.roleKey)
    const roleFields: Record<string, CooperationRoleFieldValue> = {
      ...this.data.legacyFields,
    }
    for (const goal of this.data.goals) {
      if (goal.key !== 'targetSummary' && goal.value.trim()) {
        roleFields[goal.key] = goal.value.trim()
      }
    }
    if (definition?.menu.structured === 'circles') {
      const circles = normalizeCooperationCircles(this.data.circles)
      if (Array.isArray(circles) && circles.length) {
        roleFields.circles = circles
      }
    }
    for (const field of this.data.menuFields) {
      const value = field.input === 'tags'
        ? field.value.split(/[、,，]/).map(item => item.trim()).filter(Boolean).slice(0, 12)
        : field.value.trim()
      if (Array.isArray(value) ? value.length : value) {
        roleFields[field.key] = value
      }
    }
    const quirks = normalizeCooperationQuirks(this.data.quirks)
    if (Array.isArray(quirks) && quirks.length) {
      roleFields.quirks = quirks
    }
    const targetSummary = this.data.goals.find(goal => goal.key === 'targetSummary')?.value.trim() || ''
    return {
      id: this.data.id || undefined,
      expectedVersion: this.data.id ? this.data.version : undefined,
      roleKey: this.data.roleKey,
      positioning: this.data.positioning,
      targetSummary,
      roleFields,
      abilityScores: Object.fromEntries(this.data.abilities.map(item => [item.key, item.score])),
      aiConfirmation: this.data.aiConfirmation || undefined,
    }
  },

  /** 返回时的静默暂存：不走 UI 反馈，失败也不打断返回。 */
  async saveDraftOnExit() {
    try {
      await cooperationModule.save({ ...this.buildDraftPayload(), publish: false })
    }
    catch {
      // 静默失败：网络异常时放弃暂存，用户下次进入仍可重填
    }
  },

  async save() {
    if (this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await cooperationModule.save({
        ...this.buildDraftPayload(),
        publish: false,
      })
      this.setData({ id: result.id, version: result.version })
      this.markClean()
      wx.showToast({ title: result.status === 'PUBLISHED' ? '合作卡已保存' : '草稿已保存', icon: 'success' })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        wx.navigateBack()
      }, 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
