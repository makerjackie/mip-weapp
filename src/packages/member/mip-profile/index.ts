import type { CatalogSelectorGroup } from '../../../components/catalog-selector/model'
import type { BranchId } from '../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../modules/mip-ai'
import type { ProfileTagOption } from '../../../modules/mip-identity'
import type { EditableProfileOrganization } from './organization-editor'
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
import {
  appendEditableOrganization,
  createEditableOrganizations,
  MAX_PROFILE_ORGANIZATIONS,
  moveEditableOrganization,
  normalizeEditableOrganizations,
  removeEditableOrganization,
  updateEditableOrganization,
  validateEditableOrganizations,
} from './organization-editor'

interface SelectableTag extends ProfileTagOption {
  selected: boolean
}

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
    token: '',
    aiDraftId: '',
    aiConfirmation: null as AiDraftSourceConfirmation | null,
    aiDraftLoaded: false,
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
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [] as EditableProfileOrganization[],
    organizations: [] as EditableProfileOrganization[],
    maxOrganizations: MAX_PROFILE_ORGANIZATIONS,
    visibilityNickname: true,
    visibilityRealName: false,
    visibilityGender: false,
    visibilityCareerIdentity: false,
    visibilityAvatar: true,
    visibilityIdentityStatus: true,
    visibilityHeadline: true,
    visibilityIntroduction: true,
    visibilityCompanies: true,
    visibilityOrganizations: true,
    visibilityIndustry: true,
    visibilityAbilities: true,
    visibilityPrimaryBranch: true,
    visibilityInfluence: true,
    branchOptions: [] as Array<{ id: string, label: string }>,
    branchGroups: [] as CatalogSelectorGroup[],
    selectedBranchIds: [] as string[],
    branchIndex: 0,
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
        profileVersion: snapshot.profile.version,
        userVersion: snapshot.userVersion,
        phoneBound: snapshot.phoneBound,
        nickname: aiText(aiFields, 'nickname', 64) || snapshot.profile.nickname,
        realName: snapshot.profile.realName || '',
        gender: snapshot.profile.gender || 'UNKNOWN',
        careerIdentityKey: snapshot.profile.careerIdentityKey || '',
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        identityStatus: aiText(aiFields, 'identityStatus', 32) || snapshot.profile.identityStatus,
        headline: aiText(aiFields, 'headline', 160) || snapshot.profile.headline,
        introduction: aiText(aiFields, 'introduction', 300) || snapshot.profile.introduction,
        companies: createEditableOrganizations(
          companies.length ? companies : snapshot.profile.companies,
          () => nextExperienceId('companies'),
        ),
        organizations: createEditableOrganizations(
          organizations.length ? organizations : snapshot.profile.organizations,
          () => nextExperienceId('organizations'),
        ),
        visibilityNickname: snapshot.profile.visibility.nickname !== false,
        visibilityRealName: snapshot.profile.visibility.realName === true,
        visibilityGender: snapshot.profile.visibility.gender === true,
        visibilityCareerIdentity: snapshot.profile.visibility.careerIdentity === true,
        visibilityAvatar: snapshot.profile.visibility.avatar !== false,
        visibilityIdentityStatus: snapshot.profile.visibility.identityStatus !== false,
        visibilityHeadline: snapshot.profile.visibility.headline,
        visibilityIntroduction: snapshot.profile.visibility.introduction,
        visibilityCompanies: snapshot.profile.visibility.companies,
        visibilityOrganizations: snapshot.profile.visibility.organizations,
        visibilityIndustry: snapshot.profile.visibility.industry !== false,
        visibilityAbilities: snapshot.profile.visibility.abilities !== false,
        visibilityPrimaryBranch: snapshot.profile.visibility.primaryBranch !== false,
        visibilityInfluence: snapshot.profile.visibility.influence !== false,
        branchOptions,
        branchGroups,
        selectedBranchIds: primaryBranchId ? [primaryBranchId] : [],
        branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === primaryBranchId)),
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

  changeGender(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const gender = ['UNKNOWN', 'MALE', 'FEMALE'].includes(event.detail.value)
      ? event.detail.value as 'UNKNOWN' | 'MALE' | 'FEMALE'
      : 'UNKNOWN'
    this.setData({ gender })
  },

  chooseCareerIdentity(event: WechatMiniprogram.TouchEvent) {
    this.setData({ careerIdentityKey: String(event.currentTarget.dataset.value || '') })
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

  async chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const avatarUrl = String(event.detail.avatarUrl || '')
    if (!avatarUrl || this.data.avatarUploading || this.data.saving) {
      return
    }
    this.setData({ avatarUploading: true, message: '' })
    try {
      const asset = await mipMediaModule.uploadImageFromPath('AVATAR', avatarUrl)
      this.setData({ avatarAssetId: asset.assetId, avatarUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '头像上传失败，请重试。' })
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

  updateVisibility(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if ([
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
    ].includes(field)) {
      this.setData({ [field]: Boolean(event.detail.value) })
    }
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
    if (!nickname) {
      this.setData({ message: '请填写昵称。' })
      return
    }
    if (!selectedBranch?.id) {
      this.setData({ message: '请选择主城市分会。' })
      return
    }
    const experienceError = validateEditableOrganizations(this.data.companies, '公司')
      || validateEditableOrganizations(this.data.organizations, '组织')
    if (experienceError) {
      this.setData({ message: experienceError })
      return
    }

    this.setData({ saving: true, message: '' })
    try {
      const selectedIndustry = this.data.industryOptions[this.data.industryIndex]
      await mipIdentityModule.saveProfile({
        expectedVersion: this.data.profileVersion,
        avatarAssetId: this.data.avatarAssetId || undefined,
        expectedUserVersion: this.data.userVersion,
        primaryBranchId: selectedBranch.id as BranchId,
        nickname,
        realName: this.data.realName,
        gender: this.data.gender,
        careerIdentityKey: this.data.careerIdentityKey,
        identityStatus: this.data.identityStatus,
        headline: this.data.headline,
        introduction: this.data.introduction,
        companies: normalizeEditableOrganizations(this.data.companies),
        organizations: normalizeEditableOrganizations(this.data.organizations),
        visibility: {
          nickname: this.data.visibilityNickname,
          realName: this.data.visibilityRealName,
          gender: this.data.visibilityGender,
          careerIdentity: this.data.visibilityCareerIdentity,
          avatar: this.data.visibilityAvatar,
          identityStatus: this.data.visibilityIdentityStatus,
          headline: this.data.visibilityHeadline,
          introduction: this.data.visibilityIntroduction,
          companies: this.data.visibilityCompanies,
          organizations: this.data.visibilityOrganizations,
          industry: this.data.visibilityIndustry,
          abilities: this.data.visibilityAbilities,
          primaryBranch: this.data.visibilityPrimaryBranch,
          influence: this.data.visibilityInfluence,
        },
        primaryIndustryTagId: selectedIndustry?.id || undefined,
        abilityTagIds: this.data.abilityOptions.filter(tag => tag.selected).map(tag => tag.id),
        aiConfirmation: this.data.aiConfirmation || undefined,
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
      this.setData({ message: error instanceof Error ? error.message : '资料保存失败，请重试。' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
