import { membershipModule } from '../../../modules/membership/client'
import {
  compressImageToBase64,
  IMAGE_UPLOAD_POLICIES,
} from '../../../modules/platform/image-upload'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    draftNickname: '',
    draftCity: '',
    draftHeadline: '',
    draftBio: '',
    draftOrganization: '',
    draftRoleTitle: '',
    draftIndustry: '',
    headlineCount: 0,
    bioCount: 0,
    draftTags: '',
    draftInterests: '',
    draftSkills: '',
    draftAvatarUrl: '',
    avatarChanged: false,
    saving: false,
    message: '',
  },

  onLoad() {
    const cached = membershipModule.peekOverview()
    if (cached) {
      this.applyProfile(cached.profile)
    }
    void this.loadProfile()
  },

  async loadProfile() {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const overview = await membershipModule.load()
      this.applyProfile(overview.profile)
    }
    catch (error) {
      this.setData(this.data.state === 'ready'
        ? { message: '资料更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '资料加载失败' })
    }
  },

  applyProfile(profile: Awaited<ReturnType<typeof membershipModule.load>>['profile']) {
    this.setData({
      state: 'ready',
      draftNickname: profile.nickname === '微信用户' ? '' : profile.nickname,
      draftCity: profile.city,
      draftHeadline: profile.headline,
      draftBio: profile.bio,
      draftOrganization: profile.organization || '',
      draftRoleTitle: profile.roleTitle || '',
      draftIndustry: profile.industry || '',
      headlineCount: profile.headline.length,
      bioCount: profile.bio.length,
      draftTags: profile.tags.join('、'),
      draftInterests: (profile.interests || []).join('、'),
      draftSkills: (profile.skills || []).join('、'),
      draftAvatarUrl: profile.avatarUrl,
      avatarChanged: false,
      message: '',
    })
  },

  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const avatarUrl = event.detail.avatarUrl
    if (avatarUrl) {
      this.setData({ draftAvatarUrl: avatarUrl, avatarChanged: true, message: '' })
    }
  },

  updateDraft(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if ([
      'draftNickname',
      'draftCity',
      'draftHeadline',
      'draftBio',
      'draftOrganization',
      'draftRoleTitle',
      'draftIndustry',
      'draftTags',
      'draftInterests',
      'draftSkills',
    ].includes(field)) {
      if (field === 'draftHeadline') {
        this.setData({ draftHeadline: event.detail.value, headlineCount: event.detail.value.length })
        return
      }
      if (field === 'draftBio') {
        this.setData({ draftBio: event.detail.value, bioCount: event.detail.value.length })
        return
      }
      this.setData({ [field]: event.detail.value })
    }
  },

  async saveProfile() {
    if (this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      if (this.data.avatarChanged && this.data.draftAvatarUrl) {
        const base64 = await compressImageToBase64(
          this.data.draftAvatarUrl,
          IMAGE_UPLOAD_POLICIES.avatar,
        )
        await membershipModule.uploadAvatar(base64)
      }
      await membershipModule.updateProfile({
        nickname: this.data.draftNickname,
        city: this.data.draftCity,
        headline: this.data.draftHeadline,
        bio: this.data.draftBio,
        organization: this.data.draftOrganization,
        roleTitle: this.data.draftRoleTitle,
        industry: this.data.draftIndustry,
        tags: this.data.draftTags.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean),
        interests: this.data.draftInterests.split(/[、,，]/).map(item => item.trim()).filter(Boolean),
        skills: this.data.draftSkills.split(/[、,，]/).map(item => item.trim()).filter(Boolean),
      })
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败，请重试' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
