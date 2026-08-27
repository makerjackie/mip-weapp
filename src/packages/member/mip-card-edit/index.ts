import type { ProfileOrganization } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    profileVersion: 0,
    realName: '',
    company: '',
    role: '',
    remainingCompanies: [] as ProfileOrganization[],
    organization: '',
    organizationRole: '',
    remainingOrganizations: [] as ProfileOrganization[],
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

  onLoad() { void this.load() },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const profile = await mipIdentityModule.getProfile()
      const company = profile.companies[0]
      const organization = profile.organizations[0]
      const contact = profile.privateContact
      this.setData({
        state: 'ready',
        profileVersion: profile.version,
        realName: profile.realName,
        company: company?.name || '',
        role: company?.role || '',
        remainingCompanies: profile.companies.slice(1),
        organization: organization?.name || '',
        organizationRole: organization?.role || '',
        remainingOrganizations: profile.organizations.slice(1),
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
    if (['realName', 'company', 'role', 'organization', 'organizationRole', 'wechat', 'email', 'address'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  updateVisibility(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['visibilityPhone', 'visibilityWechat', 'visibilityEmail', 'visibilityAddress'].includes(field)) {
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
    this.setData({ saving: true, message: '' })
    try {
      const primaryCompany = { name: this.data.company.trim(), role: this.data.role.trim() }
      const companies = primaryCompany.name
        ? [primaryCompany, ...this.data.remainingCompanies]
        : this.data.remainingCompanies
      const primaryOrganization = { name: this.data.organization.trim(), role: this.data.organizationRole.trim() }
      const organizations = primaryOrganization.name
        ? [primaryOrganization, ...this.data.remainingOrganizations]
        : this.data.remainingOrganizations
      await mipIdentityModule.updateCard({
        expectedVersion: this.data.profileVersion,
        realName: this.data.realName,
        companies,
        organizations,
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
      setTimeout(() => wx.navigateBack(), 300)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名片保存失败，请重试。' })
    }
    finally { this.setData({ saving: false }) }
  },
})
