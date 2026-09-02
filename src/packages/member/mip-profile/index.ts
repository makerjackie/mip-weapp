import type { CatalogSelectorGroup } from '../../../components/catalog-selector/model'
import type { AiDraftSourceConfirmation } from '../../../modules/mip-ai'
import type { ProfileOrganization, ProfileTagOption, ProfileVisibility } from '../../../modules/mip-identity'
import { aiOrganizations, aiText } from '../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../modules/mip-ai/editor-loader'
import { mipBranchesModule, mipIdentityModule } from '../../../modules/mip-identity/client'
import { careerIdentityOptions, profileGenderOptions } from '../../../modules/mip-identity/profile-options'
import {
  flattenProfileIndustries,
  groupProfileIndustries,
} from '../../../modules/mip-identity/tag-catalog'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { groupedCityBranches, opportunityModule } from '../../../modules/mip-opportunities'
import { profileBranchUpdate, profileSaveValidationMessage } from './save-intent'

interface SelectableTag extends ProfileTagOption {
  selected: boolean
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    token: '',
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
    aiOrganizationDraftLoaded: false,
    profileVersion: 0,
    userVersion: 0,
    phoneBound: false,
    phoneBinding: false,
    nickname: '',
    realName: '',
    gender: 'UNKNOWN' as 'UNKNOWN' | 'MALE' | 'FEMALE',
    careerIdentityKey: '',
    genderOptions: profileGenderOptions,
    careerIdentityOptions,
    avatarAssetId: '',
    avatarUrl: '',
    avatarUploading: false,
    avatarPending: false,
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [] as ProfileOrganization[],
    organizations: [] as ProfileOrganization[],
    profileVisibility: null as ProfileVisibility | null,
    branchOptions: [] as Array<{ id: string, label: string }>,
    branchGroups: [] as CatalogSelectorGroup[],
    selectedBranchIds: [] as string[],
    branchIndex: 0,
    savedPrimaryBranchId: '',
    branchCatalogExpanded: false,
    industryOptions: [] as Array<{ id: string, label: string }>,
    industryGroups: [] as CatalogSelectorGroup[],
    selectedIndustryIds: [] as string[],
    industryIndex: 0,
    industryCatalogExpanded: false,
    abilityOptions: [] as SelectableTag[],
    moreExpanded: false,
    saving: false,
    message: '',
  },
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(query: Record<string, string>) {
    this.setData({
      token: String(query.token || ''),
      aiDraftId: String(query.aiDraftId || ''),
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
      const [tags, branches, opportunityCatalog] = await Promise.all([
        mipIdentityModule.listProfileTags(),
        mipBranchesModule.load(snapshot.primaryBranchId, snapshot.userVersion),
        opportunityModule.getCatalogs().catch(() => null),
      ])
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
      const branchGroups = groupedCityBranches(
        branches.branches,
        opportunityCatalog?.cityTags || [],
        { separatePopular: true },
      )
      const branchOptions = [
        { id: '', label: '未选择' },
        ...branchGroups.flatMap(group => group.options),
      ]
      const primaryIndustryId = snapshot.profile.primaryIndustryTagId || ''
      const primaryBranchId = snapshot.primaryBranchId || ''
      const aiFields = aiSource?.fields || {}
      const companies = aiOrganizations(aiFields, 'companies')
      const organizations = aiOrganizations(aiFields, 'organizations')
      this.setData({
        state: 'ready',
        aiConfirmation: aiSource?.confirmation || null,
        aiDraftLoaded: Boolean(aiSource),
        aiOrganizationDraftLoaded: Boolean(companies.length || organizations.length),
        profileVersion: snapshot.profile.version,
        userVersion: snapshot.userVersion,
        phoneBound: snapshot.phoneBound,
        nickname: aiText(aiFields, 'nickname', 64) || snapshot.profile.nickname,
        realName: snapshot.profile.realName || '',
        gender: snapshot.profile.gender || 'UNKNOWN',
        careerIdentityKey: snapshot.profile.careerIdentityKey || '',
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        avatarPending: false,
        identityStatus: aiText(aiFields, 'identityStatus', 32) || snapshot.profile.identityStatus,
        headline: aiText(aiFields, 'headline', 160) || snapshot.profile.headline,
        introduction: aiText(aiFields, 'introduction', 300) || snapshot.profile.introduction,
        companies: companies.length ? companies : snapshot.profile.companies,
        organizations: organizations.length ? organizations : snapshot.profile.organizations,
        profileVisibility: snapshot.profile.visibility,
        branchOptions,
        branchGroups,
        selectedBranchIds: primaryBranchId ? [primaryBranchId] : [],
        branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === primaryBranchId)),
        savedPrimaryBranchId: primaryBranchId,
        industryOptions,
        industryGroups,
        selectedIndustryIds: primaryIndustryId ? [primaryIndustryId] : [],
        industryIndex: Math.max(0, industryOptions.findIndex(item => item.id === primaryIndustryId)),
        abilityOptions: tags
          .filter(tag => tag.kind === 'ABILITY' && tag.selectable)
          .map(tag => ({ ...tag, selected: snapshot.profile.abilityTagIds.includes(tag.id) })),
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
    if ([
      'nickname',
      'realName',
      'identityStatus',
      'headline',
      'introduction',
    ].includes(field)) {
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

  changeBranch(event: WechatMiniprogram.CustomEvent<{ selectedIds: string[] }>) {
    const selectedBranchIds = event.detail.selectedIds.slice(0, 1)
    const branchId = selectedBranchIds[0] || ''
    this.setData({
      selectedBranchIds,
      branchIndex: Math.max(0, this.data.branchOptions.findIndex(item => item.id === branchId)),
      branchCatalogExpanded: false,
    })
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

  toggleCatalog(event: WechatMiniprogram.TouchEvent) {
    const catalog = String(event.currentTarget.dataset.catalog || '')
    if (catalog === 'branch') {
      this.setData({
        branchCatalogExpanded: !this.data.branchCatalogExpanded,
        industryCatalogExpanded: false,
      })
    }
    else if (catalog === 'industry') {
      this.setData({
        branchCatalogExpanded: false,
        industryCatalogExpanded: !this.data.industryCatalogExpanded,
      })
    }
  },

  toggleMore() {
    this.setData({ moreExpanded: !this.data.moreExpanded })
  },

  toggleAbility(event: WechatMiniprogram.TouchEvent) {
    const tagId = String(event.currentTarget.dataset.id || '')
    this.setData({
      abilityOptions: this.data.abilityOptions.map(tag => tag.id === tagId
        ? { ...tag, selected: !tag.selected }
        : tag),
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
      const snapshot = await mipIdentityModule.rebindWechatPhone(code)
      this.setData({ phoneBound: snapshot.phoneBound })
      wx.showToast({ title: '手机号已更新', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '手机号更新失败，请重试。' })
    }
    finally {
      this.setData({ phoneBinding: false })
    }
  },

  async saveProfile() {
    if (this.data.saving || this.data.avatarUploading || this.data.phoneBinding) {
      return
    }
    const nickname = this.data.nickname.trim()
    const selectedBranch = this.data.branchOptions[this.data.branchIndex]
    const branchId = selectedBranch?.id || ''
    const validationMessage = profileSaveValidationMessage({
      nickname,
      branchId,
      currentBranchId: this.data.savedPrimaryBranchId,
      requirePrimaryBranch: Boolean(this.data.token),
    })
    if (validationMessage) {
      this.setData({
        moreExpanded: validationMessage === '请选择主城市分会。' || this.data.moreExpanded,
      })
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
      const snapshot = await mipIdentityModule.saveProfile({
        expectedVersion: this.data.profileVersion,
        avatarAssetId: this.data.avatarAssetId || undefined,
        ...profileBranchUpdate(branchId, this.data.userVersion),
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
        abilityTagIds: this.data.abilityOptions.filter(tag => tag.selected).map(tag => tag.id),
        aiConfirmation: this.data.aiConfirmation || undefined,
      })
      this.setData({
        profileVersion: snapshot.profile.version,
        userVersion: snapshot.userVersion,
        savedPrimaryBranchId: snapshot.primaryBranchId || '',
        phoneBound: snapshot.phoneBound,
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
