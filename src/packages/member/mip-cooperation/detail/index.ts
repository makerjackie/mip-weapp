import type { CooperationCardId } from '../../../../modules/mip'
import type { CooperationCardDetail } from '../../../../modules/mip-cooperation'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../../config/mip-catalogs'
import { cooperationModule } from '../../../../modules/mip-cooperation'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../modules/platform/case-navigation'

interface AbilityView { key: string, label: string, score: number }
interface RoleFieldView { key: string, label: string, value: string }

Page({
  data: {
    id: '' as CooperationCardId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as CooperationCardDetail | null,
    roleName: '',
    abilities: [] as AbilityView[],
    roleFields: [] as RoleFieldView[],
    acting: false,
    message: '',
  },
  resumeInterest: false,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as CooperationCardId })
    void this.load()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-cooperation/detail/index')
    if (resume?.action === 'INTERACT' && this.resumeInterest) {
      this.resumeInterest = false
      void this.performToggleInterest()
    }
    else if (this.resumeInterest) {
      this.resumeInterest = false
    }
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '合作卡信息不完整' })
      return
    }
    try {
      const item = await cooperationModule.get(this.data.id)
      const definition = cooperationRoles.find(role => role.key === item.roleKey)
      const abilities = cooperationAbilityDimensions.map(dimension => ({
        ...dimension,
        score: Number(item.abilityScores[dimension.key] || 0),
      }))
      const roleFields = (definition?.fields || []).map((field) => {
        const value = item.roleFields[field.key]
        return {
          key: field.key,
          label: field.label,
          value: Array.isArray(value) ? value.join('、') : String(value ?? ''),
        }
      })
      this.setData({ state: 'ready', item, roleName: definition?.name || item.roleKey, abilities, roleFields, message: '' })
      wx.nextTick(() => this.drawRadar())
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '合作卡加载失败' })
    }
  },

  drawRadar() {
    const query = wx.createSelectorQuery().in(this)
    query.select('#cooperation-radar').fields({ node: true, size: true }).exec((result) => {
      const entry = result?.[0] as { node?: WechatMiniprogram.Canvas, width?: number, height?: number } | undefined
      if (!entry?.node || !entry.width || !entry.height) {
        return
      }
      const canvas = entry.node
      const context = canvas.getContext('2d')
      const ratio = wx.getWindowInfo().pixelRatio
      canvas.width = entry.width * ratio
      canvas.height = entry.height * ratio
      context.scale(ratio, ratio)
      const centerX = entry.width / 2
      const centerY = entry.height / 2
      const radius = Math.min(entry.width, entry.height) * 0.38
      const point = (index: number, scale: number) => {
        const angle = -Math.PI / 2 + index * Math.PI / 3
        return { x: centerX + Math.cos(angle) * radius * scale, y: centerY + Math.sin(angle) * radius * scale }
      }
      context.strokeStyle = '#4A4A4A'
      context.lineWidth = 1
      for (let level = 1; level <= 5; level += 1) {
        context.beginPath()
        for (let index = 0; index < 6; index += 1) {
          const current = point(index, level / 5)
          if (index === 0) {
            context.moveTo(current.x, current.y)
          }
          else { context.lineTo(current.x, current.y) }
        }
        context.closePath()
        context.stroke()
      }
      context.beginPath()
      this.data.abilities.forEach((ability, index) => {
        const current = point(index, ability.score / 5)
        if (index === 0) {
          context.moveTo(current.x, current.y)
        }
        else { context.lineTo(current.x, current.y) }
      })
      context.closePath()
      context.fillStyle = 'rgba(252, 223, 3, 0.28)'
      context.strokeStyle = '#FCDF03'
      context.lineWidth = 2
      context.fill()
      context.stroke()
    })
  },

  async toggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.acting) {
      return
    }
    this.resumeInterest = true
    this.setData({ acting: true })
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'INTERACT',
        source: { navigation: 'navigateBack' },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
      this.resumeInterest = false
      this.setData({ acting: false })
      await this.performToggleInterest()
    }
    catch {
      this.resumeInterest = false
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async performToggleInterest() {
    const item = this.data.item
    if (!item || item.mine || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      const result = await cooperationModule.setOwnerInterest(item.id, !item.interestActive)
      this.setData({ 'item.interestActive': result.active })
      wx.showToast({ title: result.active ? '已标记感兴趣' : '已取消感兴趣', icon: 'none' })
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  openAuthor() {
    const profileRef = this.data.item?.author.profileRef
    if (profileRef) {
      caseNavigateTo({ url: `/packages/member/mip-public-profile/index?profileRef=${encodeURIComponent(profileRef)}` })
    }
  },

  edit() {
    if (this.data.item?.canEdit) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  async unpublish() {
    const item = this.data.item
    if (!item?.mine || item.status !== 'PUBLISHED' || this.data.acting) {
      return
    }
    const confirmation = await wx.showModal({
      title: '下架合作卡',
      content: '下架后，其他用户将无法查看这张合作卡。',
      confirmText: '确认下架',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ acting: true, message: '' })
    try {
      const result = await cooperationModule.unpublish(item.id, item.version)
      this.setData({
        'item.status': result.status,
        'item.version': result.version,
        'item.canEdit': true,
      })
      wx.showToast({ title: '合作卡已下架', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '合作卡下架失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async deleteCard() {
    const item = this.data.item
    if (!item?.mine || this.data.acting) {
      return
    }
    const confirmation = await wx.showModal({
      title: '删除合作卡',
      content: '删除后，这张合作卡将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    })
    if (!confirmation.confirm) {
      return
    }
    this.setData({ acting: true, message: '' })
    try {
      await cooperationModule.archive(item.id, item.version)
      wx.showToast({ title: '已删除', icon: 'success' })
      leaveSecondaryPage('/pages/opportunities/index')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '合作卡删除失败'
      await this.load()
      wx.showToast({ title: message, icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },
})
