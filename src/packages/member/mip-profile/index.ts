import type { BranchId } from '../../../modules/mip'
import type { AiDraftSourceConfirmation } from '../../../modules/mip-ai'
import type { ProfileTagOption } from '../../../modules/mip-identity'
import { aiOrganizations, aiText } from '../../../modules/mip-ai/editor'
import { loadAiEditorDraft } from '../../../modules/mip-ai/editor-loader'
import { mipBranchesModule, mipIdentityModule } from '../../../modules/mip-identity/client'
import { flattenProfileIndustries } from '../../../modules/mip-identity/tag-catalog'
import { mipMediaModule } from '../../../modules/mip-media/client'

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
    profileVersion: 0,
    userVersion: 0,
    phoneBound: false,
    phoneBinding: false,
    nickname: '',
    avatarAssetId: '',
    avatarUrl: '',
    avatarUploading: false,
    identityStatus: '',
    headline: '',
    introduction: '',
    companyName: '',
    companyRole: '',
    organizationName: '',
    organizationRole: '',
    visibilityNickname: true,
    visibilityAvatar: true,
    visibilityIdentityStatus: true,
    visibilityHeadline: true,
    visibilityIntroduction: true,
    visibilityCompanies: true,
    visibilityOrganizations: true,
    visibilityIndustry: true,
    visibilityAbilities: true,
    visibilityPrimaryBranch: true,
    branchOptions: [] as Array<{ id: string, label: string }>,
    branchIndex: 0,
    industryOptions: [] as Array<{ id: string, label: string }>,
    industryIndex: 0,
    abilityOptions: [] as SelectableTag[],
    saving: false,
    message: '',
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      token: String(query.token || ''),
      aiDraftId: String(query.aiDraftId || ''),
    })
    void this.loadProfile()
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
      const [tags, branches] = await Promise.all([
        mipIdentityModule.listProfileTags(),
        mipBranchesModule.load(snapshot.primaryBranchId, snapshot.userVersion),
      ])
      const industryOptions = [
        { id: '', label: '未选择' },
        ...flattenProfileIndustries(tags).map(tag => ({ id: tag.id, label: tag.displayLabel })),
      ]
      const branchOptions = [
        { id: '', label: '未选择' },
        ...branches.branches.map(branch => ({ id: branch.id, label: `${branch.cityName} · ${branch.name}` })),
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
        avatarAssetId: snapshot.profile.avatarAssetId || '',
        avatarUrl: snapshot.profile.avatarUrl || '',
        identityStatus: aiText(aiFields, 'identityStatus', 32) || snapshot.profile.identityStatus,
        headline: aiText(aiFields, 'headline', 160) || snapshot.profile.headline,
        introduction: aiText(aiFields, 'introduction', 600) || snapshot.profile.introduction,
        companyName: companies[0]?.name || snapshot.profile.companies[0]?.name || '',
        companyRole: companies[0]?.role || snapshot.profile.companies[0]?.role || '',
        organizationName: organizations[0]?.name || snapshot.profile.organizations[0]?.name || '',
        organizationRole: organizations[0]?.role || snapshot.profile.organizations[0]?.role || '',
        visibilityNickname: snapshot.profile.visibility.nickname !== false,
        visibilityAvatar: snapshot.profile.visibility.avatar !== false,
        visibilityIdentityStatus: snapshot.profile.visibility.identityStatus !== false,
        visibilityHeadline: snapshot.profile.visibility.headline,
        visibilityIntroduction: snapshot.profile.visibility.introduction,
        visibilityCompanies: snapshot.profile.visibility.companies,
        visibilityOrganizations: snapshot.profile.visibility.organizations,
        visibilityIndustry: snapshot.profile.visibility.industry !== false,
        visibilityAbilities: snapshot.profile.visibility.abilities !== false,
        visibilityPrimaryBranch: snapshot.profile.visibility.primaryBranch !== false,
        branchOptions,
        branchIndex: Math.max(0, branchOptions.findIndex(item => item.id === primaryBranchId)),
        industryOptions,
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
      'identityStatus',
      'headline',
      'introduction',
      'companyName',
      'companyRole',
      'organizationName',
      'organizationRole',
    ].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
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

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ branchIndex: Number(event.detail.value) })
  },

  changeIndustry(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ industryIndex: Number(event.detail.value) })
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
      'visibilityAvatar',
      'visibilityIdentityStatus',
      'visibilityHeadline',
      'visibilityIntroduction',
      'visibilityCompanies',
      'visibilityOrganizations',
      'visibilityIndustry',
      'visibilityAbilities',
      'visibilityPrimaryBranch',
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

    this.setData({ saving: true, message: '' })
    try {
      const selectedIndustry = this.data.industryOptions[this.data.industryIndex]
      await mipIdentityModule.saveProfile({
        expectedVersion: this.data.profileVersion,
        avatarAssetId: this.data.avatarAssetId || undefined,
        expectedUserVersion: this.data.userVersion,
        primaryBranchId: selectedBranch.id as BranchId,
        nickname,
        identityStatus: this.data.identityStatus,
        headline: this.data.headline,
        introduction: this.data.introduction,
        companies: this.data.companyName.trim()
          ? [{ name: this.data.companyName, role: this.data.companyRole || undefined }]
          : [],
        organizations: this.data.organizationName.trim()
          ? [{ name: this.data.organizationName, role: this.data.organizationRole || undefined }]
          : [],
        visibility: {
          nickname: this.data.visibilityNickname,
          avatar: this.data.visibilityAvatar,
          identityStatus: this.data.visibilityIdentityStatus,
          headline: this.data.visibilityHeadline,
          introduction: this.data.visibilityIntroduction,
          companies: this.data.visibilityCompanies,
          organizations: this.data.visibilityOrganizations,
          industry: this.data.visibilityIndustry,
          abilities: this.data.visibilityAbilities,
          primaryBranch: this.data.visibilityPrimaryBranch,
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
        setTimeout(() => wx.navigateBack({
          delta: 1,
          fail: () => wx.switchTab({ url: '/pages/profile/index' }),
        }), 300)
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
