import type { EditableProfileOrganization } from '../../../modules/mip-identity'
import {
  appendEditableOrganization,
  createEditableOrganizations,
  MAX_PROFILE_ORGANIZATIONS,
  moveEditableOrganization,
  normalizeEditableOrganizations,
  removeEditableOrganization,
  updateEditableOrganization,
  validateEditableOrganizations,
} from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { cardPreviewIdentity } from './preview'

type ExperienceCollection = 'companies' | 'organizations'

let experienceId = 0

function nextExperienceId(kind: ExperienceCollection) {
  experienceId += 1
  return `${kind}-${experienceId}`
}

function experienceCollection(value: unknown): ExperienceCollection | null {
  return value === 'companies' || value === 'organizations' ? value : null
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    profileVersion: 0,
    previewNickname: 'MIP 成员',
    previewInitial: 'M',
    previewFallbackName: 'MIP 成员',
    previewAvatarUrl: '',
    previewCodeUrl: '',
    realName: '',
    companies: [] as EditableProfileOrganization[],
    organizations: [] as EditableProfileOrganization[],
    maxOrganizations: MAX_PROFILE_ORGANIZATIONS,
    phoneBound: false,
    phoneBinding: false,
    phoneMasked: '',
    wechat: '',
    email: '',
    address: '',
    visibilityPhone: false,
    visibilityWechat: false,
    visibilityEmail: false,
    visibilityAddress: false,
    saving: false,
    message: '',
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad() { void this.load() },

  onHide() { this.clearNavigationTimer() },
  onUnload() { this.clearNavigationTimer() },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
    }
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const [profile, cardCode] = await Promise.all([
        mipIdentityModule.getProfile(),
        mipIdentityModule.getMyProfileCardCode().catch(() => ({ codeUrl: '' })),
      ])
      const preview = cardPreviewIdentity(profile)
      const contact = profile.privateContact
      this.setData({
        state: 'ready',
        profileVersion: profile.version,
        previewNickname: preview.name,
        previewInitial: preview.initial,
        previewFallbackName: profile.nickname || 'MIP 成员',
        previewAvatarUrl: profile.avatarUrl || '',
        previewCodeUrl: cardCode.codeUrl,
        realName: profile.realName,
        companies: createEditableOrganizations(profile.companies, () => nextExperienceId('companies')),
        organizations: createEditableOrganizations(profile.organizations, () => nextExperienceId('organizations')),
        phoneBound: Boolean(contact?.phoneBound),
        phoneMasked: contact?.phoneMasked || '',
        wechat: contact?.wechat || '',
        email: contact?.email || '',
        address: contact?.address || '',
        visibilityPhone: profile.visibility.cardContacts?.phone === true,
        visibilityWechat: profile.visibility.cardContacts?.wechat === true,
        visibilityEmail: profile.visibility.cardContacts?.email === true,
        visibilityAddress: profile.visibility.cardContacts?.address === true,
      })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '名片设置加载失败' })
    }
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['realName', 'wechat', 'email', 'address'].includes(field)) {
      const value = event.detail.value
      const updates: Record<string, string> = { [field]: value }
      if (field === 'realName') {
        const preview = cardPreviewIdentity({ realName: value, nickname: this.data.previewFallbackName })
        updates.previewNickname = preview.name
        updates.previewInitial = preview.initial
      }
      this.setData(updates)
    }
  },

  addExperience(event: WechatMiniprogram.TouchEvent) {
    const kind = experienceCollection(event.currentTarget.dataset.kind)
    if (!kind) {
      return
    }
    const items = this.data[kind]
    if (items.length >= MAX_PROFILE_ORGANIZATIONS) {
      this.setData({ message: `${kind === 'companies' ? '公司' : '组织'}经历最多添加 ${MAX_PROFILE_ORGANIZATIONS} 条。` })
      return
    }
    this.setData({
      [kind]: appendEditableOrganization(items, nextExperienceId(kind)),
      message: '',
    })
  },

  updateExperience(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const kind = experienceCollection(event.currentTarget.dataset.kind)
    const field = event.currentTarget.dataset.field
    const index = Number(event.currentTarget.dataset.index)
    if (!kind || (field !== 'name' && field !== 'role') || !Number.isInteger(index)) {
      return
    }
    this.setData({
      [kind]: updateEditableOrganization(this.data[kind], index, field, event.detail.value),
      message: '',
    })
  },

  moveExperience(event: WechatMiniprogram.TouchEvent) {
    const kind = experienceCollection(event.currentTarget.dataset.kind)
    const index = Number(event.currentTarget.dataset.index)
    const direction = Number(event.currentTarget.dataset.direction)
    if (!kind || !Number.isInteger(index) || (direction !== -1 && direction !== 1)) {
      return
    }
    this.setData({
      [kind]: moveEditableOrganization(this.data[kind], index, direction),
      message: '',
    })
  },

  removeExperience(event: WechatMiniprogram.TouchEvent) {
    const kind = experienceCollection(event.currentTarget.dataset.kind)
    const index = Number(event.currentTarget.dataset.index)
    if (!kind || !Number.isInteger(index)) {
      return
    }
    this.setData({
      [kind]: removeEditableOrganization(this.data[kind], index),
      message: '',
    })
  },

  async bindPhone(event: WechatMiniprogram.CustomEvent<{ code?: string, errMsg?: string }>) {
    if (this.data.phoneBinding || this.data.saving) {
      return
    }
    const code = String(event.detail.code || '')
    if (!code) {
      this.setData({
        message: /cancel|deny/i.test(String(event.detail.errMsg || ''))
          ? '你已取消手机号授权，绑定状态未变更。'
          : '手机号授权必须在微信真机完成。',
      })
      return
    }
    this.setData({ phoneBinding: true, message: '' })
    try {
      await mipIdentityModule.rebindWechatPhone(code)
      await this.load()
      wx.showToast({ title: '手机号已更新', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号更新失败，请重试。' })
    }
    finally {
      this.setData({ phoneBinding: false })
    }
  },

  async save() {
    if (this.data.saving || this.data.phoneBinding) {
      return
    }
    const experienceError = validateEditableOrganizations(this.data.companies, '公司')
      || validateEditableOrganizations(this.data.organizations, '组织')
    if (experienceError) {
      this.setData({ message: experienceError })
      wx.showToast({ title: experienceError, icon: 'none' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipIdentityModule.updateCard({
        expectedVersion: this.data.profileVersion,
        realName: this.data.realName,
        companies: normalizeEditableOrganizations(this.data.companies),
        organizations: normalizeEditableOrganizations(this.data.organizations),
        wechat: this.data.wechat,
        email: this.data.email,
        address: this.data.address,
        visibility: {
          cardContacts: {
            phone: this.data.visibilityPhone,
            wechat: this.data.visibilityWechat,
            email: this.data.visibilityEmail,
            address: this.data.visibilityAddress,
          },
        },
      })
      wx.showToast({ title: '名片已保存', icon: 'success' })
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        wx.navigateBack()
      }, 300)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名片保存失败，请重试。' })
    }
    finally { this.setData({ saving: false }) }
  },
})
