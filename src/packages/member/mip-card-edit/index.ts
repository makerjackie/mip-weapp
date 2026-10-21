import type { EditableProfileOrganization } from '../../../modules/mip-identity'
import { memberCardArt } from '../../../config/card-art'
import {
  appendEditableOrganization,
  createEditableOrganizations,
  editExperienceRow,
  MAX_PROFILE_ORGANIZATIONS,
  moveEditableOrganization,
  normalizeEditableOrganizations,
  removeEditableOrganization,
  validateEditableOrganizations,
} from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { caseNavigateTo } from '../../../platform/navigation/client'
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
    previewCardBgUrl: memberCardArt.YELLOW.asset,
    previewNickname: 'MIP 成员',
    previewInitial: 'M',
    previewFallbackName: 'MIP 成员',
    previewAvatarUrl: '',
    previewCodeUrl: '',
    formAvatarUrl: '',
    avatarAssetId: '',
    avatarUploading: false,
    previewCompany: '公司',
    previewRole: '职位',
    previewOrganization: '组织',
    previewOrganizationRole: '职位',
    previewPhone: '',
    previewWechat: '',
    previewEmail: '',
    previewAddress: '',
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
  requestSeq: 0,
  navigationTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad() { void this.load() },

  // figma 1732_20291 底部「预览」：打开名片详情页查看保存效果。
  openPreview() {
    caseNavigateTo({ url: '/packages/member/mip-card/index' })
  },

  onHide() { this.clearNavigationTimer() },
  onUnload() {
    this.requestSeq += 1
    this.clearNavigationTimer()
  },

  clearNavigationTimer() {
    if (this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer)
      this.navigationTimer = undefined
      // BUG-08:待返回定时器被取消而页面未出栈时(如保存后 300ms 内切后台再回来),
      // 同步放开保存锁,避免按钮永久 loading;请求在途时没有定时器,不走到这里。
      this.setData({ saving: false })
    }
  },

  // 名片卡预览（figma 1732_20291）：第一段公司/组织与联系方式即时同步，
  // 空值回退为字段名占位（figma 2169_17541 空数据卡：姓名/公司/职位/电话/微信/邮箱/地址）。
  syncPreview() {
    const company = this.data.companies[0]
    const organization = this.data.organizations[0]
    const preview = cardPreviewIdentity({ realName: this.data.realName, nickname: this.data.previewFallbackName }, '姓名')
    this.setData({
      previewNickname: preview.name,
      previewInitial: preview.initial,
      previewCompany: company?.name || '公司',
      previewRole: company?.role || '职位',
      previewOrganization: organization?.name || '组织',
      previewOrganizationRole: organization?.role || '职位',
      previewPhone: this.data.phoneMasked || '电话',
      previewWechat: this.data.wechat || '微信',
      previewEmail: this.data.email || '邮箱',
      previewAddress: this.data.address || '地址',
    })
  },

  async load() {
    const requestSeq = ++this.requestSeq
    this.setData({ state: 'loading', message: '' })
    // The preview code can arrive later without blocking the editable profile.
    void mipIdentityModule.getMyProfileCardCode().then((cardCode) => {
      if (requestSeq === this.requestSeq) {
        this.setData({ previewCodeUrl: cardCode.codeUrl })
      }
    }).catch(() => {})
    try {
      const profile = await mipIdentityModule.getProfile()
      if (requestSeq !== this.requestSeq) {
        return
      }
      const contact = profile.privateContact
      this.setData({
        state: 'ready',
        profileVersion: profile.version,
        previewFallbackName: profile.nickname || 'MIP 成员',
        previewAvatarUrl: profile.avatarUrl || '',
        formAvatarUrl: profile.avatarUrl || '',
        avatarAssetId: profile.avatarAssetId || '',
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
      this.syncPreview()
    }
    catch (error) {
      if (requestSeq !== this.requestSeq) {
        return
      }
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '名片设置加载失败' })
    }
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['realName', 'wechat', 'email', 'address'].includes(field)) {
      this.setData({ [field]: event.detail.value })
      this.syncPreview()
    }
  },

  // figma 1732_20291「更换头像」：微信头像选择 + AVATAR 资产上传，随名片保存绑定。
  async chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl?: string }>) {
    const avatarUrl = String(event.detail.avatarUrl || '')
    if (!avatarUrl || this.data.avatarUploading || this.data.saving) {
      return
    }
    this.setData({ avatarUploading: true, message: '' })
    try {
      const asset = await mipMediaModule.uploadImageFromPath('AVATAR', avatarUrl)
      this.setData({
        avatarAssetId: asset.assetId,
        formAvatarUrl: asset.imageUrl,
        previewAvatarUrl: asset.imageUrl,
      })
      wx.showToast({ title: '头像已选择，请保存名片', icon: 'none' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '头像上传失败，请重试。' })
    }
    finally {
      this.setData({ avatarUploading: false })
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
    this.syncPreview()
  },

  updateExperience(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const kind = experienceCollection(event.currentTarget.dataset.kind)
    const field = event.currentTarget.dataset.field
    const index = Number(event.currentTarget.dataset.index)
    if (!kind || (field !== 'name' && field !== 'role') || !Number.isInteger(index)) {
      return
    }
    this.setData({
      [kind]: editExperienceRow(this.data[kind], index, field, event.detail.value, nextExperienceId(kind)),
      message: '',
    })
    this.syncPreview()
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
    this.syncPreview()
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
    this.syncPreview()
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
          : '手机号授权需在手机上完成。',
      })
      return
    }
    this.setData({ phoneBinding: true, message: '' })
    try {
      await mipIdentityModule.rebindWechatPhone(code)
      const profile = await mipIdentityModule.getProfile()
      this.setData({
        profileVersion: profile.version,
        phoneBound: Boolean(profile.privateContact?.phoneBound),
        phoneMasked: profile.privateContact?.phoneMasked || '',
      })
      this.syncPreview()
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
      const snapshot = await mipIdentityModule.updateCard({
        expectedVersion: this.data.profileVersion,
        realName: this.data.realName,
        companies: normalizeEditableOrganizations(this.data.companies),
        organizations: normalizeEditableOrganizations(this.data.organizations),
        avatarAssetId: this.data.avatarAssetId || undefined,
        wechat: this.data.wechat,
        email: this.data.email,
        address: this.data.address,
        // 名片编辑即名片发布（figma 1732_20291 无独立展示开关）：填了哪个联系方式，
        // 哪个就出现在名片上；清空即下卡。手机号跟随绑定状态。
        visibility: {
          cardContacts: {
            phone: this.data.phoneBound,
            wechat: Boolean(this.data.wechat.trim()),
            email: Boolean(this.data.email.trim()),
            address: Boolean(this.data.address.trim()),
          },
        },
      })
      const cardContacts = snapshot.profile.visibility?.cardContacts
      if (cardContacts) {
        this.setData({
          profileVersion: snapshot.profile.version,
          visibilityPhone: cardContacts.phone === true,
          visibilityWechat: cardContacts.wechat === true,
          visibilityEmail: cardContacts.email === true,
          visibilityAddress: cardContacts.address === true,
        })
      }
      wx.showToast({ title: '名片已保存', icon: 'success' })
      // BUG-08:成功后进入「toast 展示 300ms 再返回」窗口,期间保持 saving=true,
      // 否则按钮 loading 解除但页面还在,再点保存会发起第二次真实写入;
      // 页面即将出栈,成功路径不复位 saving,由 clearNavigationTimer 兜底。
      this.clearNavigationTimer()
      this.navigationTimer = setTimeout(() => {
        this.navigationTimer = undefined
        wx.navigateBack()
      }, 300)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名片保存失败，请重试。' })
      // BUG-08:仅失败/异常路径复位保存锁;成功路径页面即将离开,保持锁定。
      this.setData({ saving: false })
    }
  },
})
