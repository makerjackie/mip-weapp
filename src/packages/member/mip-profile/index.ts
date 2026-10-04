import type { CatalogSelectorGroup } from '../../../components/catalog-selector/model'
import type { AiDraftSourceConfirmation } from '../../../modules/mip-ai'
import type { ProfileOrganization, ProfileVisibility } from '../../../modules/mip-identity'
import { aiOrganizations, aiText } from '../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../modules/mip-ai/editor-loader'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { careerIdentityOptions, profileGenderOptions } from '../../../modules/mip-identity/profile-options'
import {
  flattenProfileIndustries,
  groupProfileIndustries,
} from '../../../modules/mip-identity/tag-catalog'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { profileSaveValidationMessage } from './save-intent'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    // ui-fidelity fixture 开关：默认走生产布局（被 vitest pin）。
    figmaLayout: false,
    token: '',
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
    aiOrganizationDraftLoaded: false,
    profileVersion: 0,
    nickname: '',
    // 姓名输入框已下线，但保存接口按整行覆盖存储（未传即清空），需加载后原值回传。
    realName: '',
    gender: 'UNKNOWN' as 'UNKNOWN' | 'MALE' | 'FEMALE',
    careerIdentityKey: '',
    genderOptions: profileGenderOptions,
    careerIdentityOptions,
    avatarAssetId: '',
    avatarUrl: '',
    avatarUploading: false,
    avatarPending: false,
    // 身份说明/补充介绍编辑入口已下线，同样按整行覆盖存储，需原值回传。
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [] as ProfileOrganization[],
    organizations: [] as ProfileOrganization[],
    profileVisibility: null as ProfileVisibility | null,
    industryOptions: [] as Array<{ id: string, label: string }>,
    industryGroups: [] as CatalogSelectorGroup[],
    selectedIndustryIds: [] as string[],
    industryIndex: 0,
    industryCatalogExpanded: false,
    // 能力标签属于合作卡属性，此处仅回传存量，不再提供编辑入口。
    abilityTagIds: [] as string[],
    saving: false,
    message: '',
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(query: Record<string, string>) {
    this.setData({
      token: String(query.token || ''),
      aiDraftId: '',
    })
    void this.loadProfile()
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

  async loadProfile() {
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      let aiSource = null
      let aiMessage = ''
      if (this.data.aiDraftId) {
        try {
          aiSource = await loadAiEditorDraft(this.data.aiDraftId, 'PROFILE')
        }
        catch (error) {
          aiMessage = error instanceof Error ? error.message : 'AI 草稿加载失败'
        }
      }
      const tags = await mipIdentityModule.listProfileTags()
      const industryOptions = [
        { id: '', label: '未选择' },
        ...flattenProfileIndustries(tags).map(tag => ({ id: tag.id, label: tag.displayLabel })),
      ]
      const industryGroups = groupProfileIndustries(tags).map(group => ({
        id: group.id,
        label: group.label,
        options: group.options.map(option => ({
          id: option.id,
          label: option.label,
          popular: option.popular,
        })),
      }))
      const primaryIndustryId = snapshot.profile.primaryIndustryTagId || ''
      const aiFields = aiSource?.fields || {}
      const companies = aiOrganizations(aiFields, 'companies')
      const organizations = aiOrganizations(aiFields, 'organizations')
      this.setData({
        state: 'ready',
        aiConfirmation: aiSource?.confirmation || null,
        aiDraftLoaded: Boolean(aiSource),
        aiOrganizationDraftLoaded: Boolean(companies.length || organizations.length),
        profileVersion: snapshot.profile.version,
        nickname: aiText(aiFields, 'nickname', 64) || snapshot.profile.nickname,
        realName: snapshot.profile.realName || '',
        gender: snapshot.profile.gender || 'UNKNOWN',
        careerIdentityKey: snapshot.profile.careerIdentityKey || '',
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        avatarPending: false,
        identityStatus: snapshot.profile.identityStatus,
        headline: aiText(aiFields, 'headline', 160) || snapshot.profile.headline,
        introduction: snapshot.profile.introduction,
        companies: companies.length ? companies : snapshot.profile.companies,
        organizations: organizations.length ? organizations : snapshot.profile.organizations,
        profileVisibility: snapshot.profile.visibility,
        industryOptions,
        industryGroups,
        selectedIndustryIds: primaryIndustryId ? [primaryIndustryId] : [],
        industryIndex: Math.max(0, industryOptions.findIndex(item => item.id === primaryIndustryId)),
        abilityTagIds: snapshot.profile.abilityTagIds,
        message: aiMessage,
      })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '资料加载失败',
      })
    }
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['nickname', 'headline'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  showEditorMessage(message: string) {
    this.setData({ message })
    wx.showToast({ title: message, icon: 'none' })
  },

  changeGender(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const gender = ['UNKNOWN', 'MALE', 'FEMALE'].includes(event.detail.value)
      ? event.detail.value as 'UNKNOWN' | 'MALE' | 'FEMALE'
      : 'UNKNOWN'
    this.setData({ gender })
  },

  chooseCareerIdentity(event: WechatMiniprogram.TouchEvent) {
    this.setData({ careerIdentityKey: String(event.currentTarget.dataset.value || '') })
  },

  async chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const avatarUrl = String(event.detail.avatarUrl || '')
    if (!avatarUrl || this.data.avatarUploading || this.data.saving) {
      return
    }
    this.setData({ avatarUploading: true, message: '' })
    try {
      const asset = await mipMediaModule.uploadImageFromPath('AVATAR', avatarUrl)
      this.setData({ avatarAssetId: asset.assetId, avatarUrl: asset.imageUrl, avatarPending: true })
      wx.showToast({ title: '头像已选择，请保存资料', icon: 'none' })
    }
    catch (error) {
      this.showEditorMessage(error instanceof Error ? error.message : '头像上传失败，请重试。')
    }
    finally {
      this.setData({ avatarUploading: false })
    }
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const selectedIndustryIds = event.detail.selectedIds.slice(0, 1)
    const industryId = selectedIndustryIds[0] || ''
    this.setData({
      selectedIndustryIds,
      industryIndex: Math.max(0, this.data.industryOptions.findIndex(item => item.id === industryId)),
      industryCatalogExpanded: false,
    })
  },

  toggleCatalog() {
    this.setData({ industryCatalogExpanded: !this.data.industryCatalogExpanded })
  },

  async saveProfile() {
    if (this.data.saving || this.data.avatarUploading) {
      return
    }
    const nickname = this.data.nickname.trim()
    const validationMessage = profileSaveValidationMessage({ nickname })
    if (validationMessage) {
      this.showEditorMessage(validationMessage)
      return
    }
    if (!this.data.profileVisibility) {
      this.showEditorMessage('资料状态尚未加载，请重新进入后再试。')
      return
    }

    this.setData({ saving: true, message: '' })
    try {
      const selectedIndustry = this.data.industryOptions[this.data.industryIndex]
      // 主城市分会由管理后台在开通会员时配置，此页不再提交；载荷不带分会
      // 字段时服务端保留用户现有分会不变。
      const snapshot = await mipIdentityModule.saveProfile({
        expectedVersion: this.data.profileVersion,
        avatarAssetId: this.data.avatarAssetId || undefined,
        nickname,
        realName: this.data.realName,
        gender: this.data.gender,
        careerIdentityKey: this.data.careerIdentityKey,
        identityStatus: this.data.identityStatus,
        headline: this.data.headline,
        introduction: this.data.introduction,
        companies: this.data.companies,
        organizations: this.data.organizations,
        visibility: this.data.profileVisibility,
        primaryIndustryTagId: selectedIndustry?.id || undefined,
        abilityTagIds: this.data.abilityTagIds,
        aiConfirmation: this.data.aiConfirmation || undefined,
      })
      this.setData({
        profileVersion: snapshot.profile.version,
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        avatarPending: false,
        profileVisibility: snapshot.profile.visibility,
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
      if (this.data.token) {
        wx.navigateBack({
          delta: 1,
          fail: () => wx.redirectTo({
            url: `/packages/member/mip-access/index?token=${encodeURIComponent(this.data.token)}`,
          }),
        })
      }
      else {
        this.clearNavigationTimer()
        this.navigationTimer = setTimeout(() => {
          this.navigationTimer = undefined
          wx.navigateBack({
            delta: 1,
            fail: () => wx.switchTab({ url: '/pages/profile/index' }),
          })
        }, 300)
      }
    }
    catch (error) {
      this.showEditorMessage(error instanceof Error ? error.message : '资料保存失败，请重试。')
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
