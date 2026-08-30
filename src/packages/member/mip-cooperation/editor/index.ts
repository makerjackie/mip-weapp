import type { CooperationCardId, CooperationRoleKey } from '../../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../../modules/mip-ai'
import type { CooperationCardDetail } from '../../../../modules/mip-cooperation'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../../config/mip-catalogs'
import { aiObject, aiText } from '../../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../../modules/mip-ai/editor-loader'
import { cooperationModule } from '../../../../modules/mip-cooperation'
import { caseNavigateTo } from '../../../../modules/platform/case-navigation'

interface RoleOption { key: CooperationRoleKey, name: string }
interface FieldView { key: string, label: string, placeholder: string, value: string, input: string }
interface AbilityView { key: string, label: string, score: number }

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
  return Number.isFinite(score) ? Math.min(5, Math.max(0, Math.round(score))) : fallback
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
    roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name })) as RoleOption[],
    roleIndex: 0,
    roleKey: 'connector' as CooperationRoleKey,
    roleLocked: false,
    positioning: '',
    targetSummary: '',
    fields: [] as FieldView[],
    abilities: cooperationAbilityDimensions.map(item => ({ ...item, score: 3 })) as AbilityView[],
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

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

  onUnload() {
    this.clearNavigationTimer()
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
        const roleFields = aiObject(aiSource.fields, 'roleFields')
        const abilityScores = aiObject(aiSource.fields, 'abilityScores')
        this.setData({
          positioning: aiText(aiSource.fields, 'positioning', 500) || this.data.positioning,
          targetSummary: aiText(aiSource.fields, 'targetSummary', 500),
          fields: this.data.fields.map(field => ({
            ...field,
            value: aiFieldValue(roleFields[field.key]),
          })),
          abilities: this.data.abilities.map(item => ({
            ...item,
            score: aiScore(abilityScores[item.key], item.score),
          })),
          aiConfirmation: aiSource.confirmation,
          aiDraftLoaded: true,
        })
      }
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyRole(roleKey: CooperationRoleKey, detail: CooperationCardDetail | null) {
    const definition = cooperationRoles.find(role => role.key === roleKey) || cooperationRoles[0]
    this.setData({
      roleKey,
      roleIndex: Math.max(0, cooperationRoles.findIndex(role => role.key === roleKey)),
      roleLocked: Boolean(detail),
      positioning: detail?.positioning || definition.positioning,
      targetSummary: detail?.targetSummary || '',
      fields: definition.fields.map((field) => {
        const value = detail?.roleFields[field.key]
        return {
          key: field.key,
          label: field.label,
          placeholder: field.placeholder,
          input: field.input,
          value: Array.isArray(value) ? value.join('、') : String(value ?? ''),
        }
      }),
      abilities: cooperationAbilityDimensions.map(item => ({
        ...item,
        score: Number(detail?.abilityScores[item.key] ?? 3),
      })),
      version: detail?.version || 0,
    })
  },

  changeRole(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.data.roleLocked) {
      return
    }
    const roleIndex = Number(event.detail.value)
    const role = cooperationRoles[roleIndex]
    if (role) {
      this.applyRole(role.key, null)
    }
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['positioning', 'targetSummary'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },

  updateRoleField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ fields: this.data.fields.map(item => item.key === key ? { ...item, value: event.detail.value } : item) })
  },

  updateAbility(event: WechatMiniprogram.CustomEvent<{ value: number }>) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ abilities: this.data.abilities.map(item => item.key === key ? { ...item, score: Number(event.detail.value) } : item) })
  },

  openAiAssistant() {
    caseNavigateTo({ url: '/packages/member/mip-ai/index' })
  },

  saveDraft() { void this.save(false, 'back') },
  preview() { void this.save(false, 'preview') },
  publish() { void this.save(true, 'back') },

  async save(publish: boolean, destination: 'back' | 'preview') {
    if (this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const definition = cooperationRoles.find(role => role.key === this.data.roleKey)
      const inputByKey = new Map(definition?.fields.map(field => [field.key, field.input]) || [])
      const roleFields = Object.fromEntries(this.data.fields.map((field) => {
        const value = inputByKey.get(field.key) === 'tags'
          ? field.value.split(/[、,，]/).map(item => item.trim()).filter(Boolean)
          : field.value
        return [field.key, value]
      }))
      const result = await cooperationModule.save({
        id: this.data.id || undefined,
        expectedVersion: this.data.id ? this.data.version : undefined,
        roleKey: this.data.roleKey,
        positioning: this.data.positioning,
        targetSummary: this.data.targetSummary,
        roleFields,
        abilityScores: Object.fromEntries(this.data.abilities.map(item => [item.key, item.score])),
        publish,
        aiConfirmation: this.data.aiConfirmation || undefined,
      })
      this.setData({ id: result.id, version: result.version })
      wx.showToast({ title: result.status === 'PUBLISHED' ? '合作卡已发布' : '草稿已保存', icon: 'success' })
      if (destination === 'preview') {
        await wx.navigateTo({
          url: `/packages/member/mip-cooperation/detail/index?id=${encodeURIComponent(result.id)}`,
        })
      }
      else {
        this.clearNavigationTimer()
        this.navigationTimer = setTimeout(() => {
          this.navigationTimer = undefined
          wx.navigateBack()
        }, 500)
      }
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
