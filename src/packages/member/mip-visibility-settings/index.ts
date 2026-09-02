import type { MipProfileSnapshot } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import {
  profileVisibilityUpdate,
  visibilitySelection,
} from './visibility-save-intent'

type VisibilityField = keyof ReturnType<typeof visibilitySelection>

const visibilityFields = new Set<VisibilityField>([
  'visibilityNickname',
  'visibilityRealName',
  'visibilityGender',
  'visibilityCareerIdentity',
  'visibilityAvatar',
  'visibilityIdentityStatus',
  'visibilityHeadline',
  'visibilityIntroduction',
  'visibilityCompanies',
  'visibilityOrganizations',
  'visibilityIndustry',
  'visibilityAbilities',
  'visibilityPrimaryBranch',
  'visibilityInfluence',
  'visibilityPhone',
  'visibilityWechat',
  'visibilityEmail',
  'visibilityAddress',
])

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    phoneBound: false,
    ...visibilitySelection({ headline: true, introduction: true, companies: true, organizations: true }),
    saving: false,
    message: '',
  },
  profileSnapshot: null as MipProfileSnapshot | null,

  onLoad() {
    void this.load()
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const profile = await mipIdentityModule.getProfile()
      this.profileSnapshot = profile
      this.setData({
        state: 'ready',
        phoneBound: profile.privateContact?.phoneBound === true,
        ...visibilitySelection(profile.visibility),
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '公开设置加载失败。',
      })
    }
  },

  updateVisibility(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(event.currentTarget.dataset.field || '') as VisibilityField
    if (!visibilityFields.has(field) || this.data.saving) {
      return
    }
    this.setData({ [field]: Boolean(event.detail.value), message: '' })
  },

  async save() {
    const profile = this.profileSnapshot
    if (!profile || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const snapshot = await mipIdentityModule.saveProfile(profileVisibilityUpdate(profile, this.data))
      this.profileSnapshot = snapshot.profile
      this.setData({
        phoneBound: snapshot.profile.privateContact?.phoneBound === true,
        ...visibilitySelection(snapshot.profile.visibility),
      })
      wx.showToast({ title: '公开设置已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '公开设置保存失败，请重试。' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
