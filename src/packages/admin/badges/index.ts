import type { AdminBadge, AdminBadgeAward } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure } from '../shared/page-state'

const statusText = { DRAFT: '草稿', ACTIVE: '启用', INACTIVE: '停用' } as const

interface BadgeView extends AdminBadge { statusText: string }

Page({
  data: {
    state: 'loading' as AdminPageState,
    badges: [] as BadgeView[],
    awards: [] as AdminBadgeAward[],
    canManage: false,
    editorId: '',
    editorVersion: 0,
    key: '',
    name: '',
    description: '',
    iconName: '',
    imageUrl: '',
    placeholderShape: 'CIRCLE' as AdminBadge['placeholderShape'],
    sortOrder: '0',
    status: 'DRAFT' as AdminBadge['status'],
    awardUserId: '',
    awardBadgeId: '',
    awardReason: '',
    awardQuery: '',
    saving: false,
    message: '',
  },

  onShow() {
    void this.loadPage()
  },

  async loadPage(force = false) {
    const hasContent = this.data.badges.length > 0 || this.data.awards.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [session, badges, awards] = await Promise.all([
        mipAdminModule.getSession(force),
        mipAdminModule.listBadges(force),
        mipAdminModule.listBadgeAwards(
          { query: this.data.awardQuery.trim(), status: '' },
          force,
        ),
      ])
      this.setData({
        state: 'ready',
        badges: badges.items.map(item => ({ ...item, statusText: statusText[item.status] })),
        awards: awards.items,
        canManage: hasCapability(session.capabilities, 'badges.manage'),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '勋章管理加载失败' }))
    }
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['key', 'name', 'description', 'iconName', 'imageUrl', 'sortOrder', 'awardUserId', 'awardReason', 'awardQuery'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  chooseShape(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || 'CIRCLE')
    if (['CIRCLE', 'DIAMOND', 'HEXAGON'].includes(value)) {
      this.setData({ placeholderShape: value as AdminBadge['placeholderShape'] })
    }
  },

  chooseStatus(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value || 'DRAFT')
    if (['DRAFT', 'ACTIVE', 'INACTIVE'].includes(value)) {
      this.setData({ status: value as AdminBadge['status'] })
    }
  },

  chooseAwardBadge(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (this.data.badges.some(item => item.id === id && item.status === 'ACTIVE')) {
      this.setData({ awardBadgeId: id })
    }
  },

  editBadge(event: WechatMiniprogram.TouchEvent) {
    const badge = this.data.badges.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!badge) {
      return
    }
    this.setData({
      editorId: badge.id,
      editorVersion: badge.version,
      key: badge.key,
      name: badge.name,
      description: badge.description,
      iconName: badge.iconName,
      imageUrl: badge.imageUrl,
      placeholderShape: badge.placeholderShape,
      sortOrder: String(badge.sortOrder),
      status: badge.status,
      message: '',
    })
  },

  resetEditor() {
    this.setData({
      editorId: '',
      editorVersion: 0,
      key: '',
      name: '',
      description: '',
      iconName: '',
      imageUrl: '',
      placeholderShape: 'CIRCLE',
      sortOrder: '0',
      status: 'DRAFT',
      message: '',
    })
  },

  async saveBadge() {
    if (!this.data.canManage || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.saveBadge({
        badgeId: this.data.editorId || undefined,
        expectedVersion: this.data.editorId ? this.data.editorVersion : undefined,
        draft: {
          key: this.data.key,
          name: this.data.name,
          description: this.data.description,
          iconName: this.data.iconName,
          imageUrl: this.data.imageUrl,
          placeholderShape: this.data.placeholderShape,
          sortOrder: Number(this.data.sortOrder),
          status: this.data.status,
        },
      }))
      this.resetEditor()
      await this.loadPage(true)
      wx.showToast({ title: '勋章已保存', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '勋章保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async grantBadge() {
    if (!this.data.canManage || this.data.saving) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.grantBadge({
        userId: this.data.awardUserId.trim(),
        badgeId: this.data.awardBadgeId,
        reason: this.data.awardReason.trim(),
      }))
      this.setData({ awardReason: '' })
      await this.loadPage(true)
      wx.showToast({ title: '勋章已授予', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '勋章授予失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async revokeBadge(event: WechatMiniprogram.TouchEvent) {
    const award = this.data.awards.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!award || award.status !== 'ACTIVE' || this.data.saving) {
      return
    }
    const confirmation = await wx.showModal({
      title: '撤销勋章',
      content: award.equipped ? '该勋章仍在佩戴中，需用户先取消佩戴。' : '',
      editable: !award.equipped,
      placeholderText: '填写撤销原因',
      confirmText: award.equipped ? '知道了' : '确认撤销',
    }).catch(() => null)
    if (!confirmation?.confirm || award.equipped) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.revokeBadge({
        awardId: award.id,
        expectedVersion: award.version,
        reason: String(confirmation.content || '').trim(),
      }))
      await this.loadPage(true)
      wx.showToast({ title: '勋章已撤销', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '勋章撤销失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },

  searchAwards() {
    void this.loadPage(true)
  },
})
