import type { CooperationCardId } from '../../../../modules/mip'
import type { CooperationCardDetail, CooperationRoleFieldValue } from '../../../../modules/mip-cooperation'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../../config/mip-catalogs'
import { cooperationModule, normalizeCooperationCircles, normalizeCooperationQuirks } from '../../../../modules/mip-cooperation'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../platform/navigation/client'

interface AbilityView { key: string, label: string, score: number }
interface RoleFieldView { key: string, label: string, value: string }
interface CircleGroupView { name: string, identity: string, years: string, trait: string }
interface QuirkGroupView { external: string, internal: string, advice: string }

function authorLineOf(item: CooperationCardDetail) {
  return [item.author.cityName?.trim(), item.author.primaryIndustry?.label?.trim()]
    .filter((line): line is string => Boolean(line))
    .join('丨')
}

function textEntries(value: CooperationRoleFieldValue | undefined) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

Page({
  data: {
    id: '' as CooperationCardId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as CooperationCardDetail | null,
    abilities: [] as AbilityView[],
    roleFields: [] as RoleFieldView[],
    circles: [] as CircleGroupView[],
    quirks: [] as QuirkGroupView[],
    maxValue: '',
    authorLine: '',
    acting: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as CooperationCardId })
    void this.load()
  },

  onShow() {
    if (this.data.state === 'ready') {
      wx.nextTick(() => this.drawRadar())
    }
  },

  onResize() {
    if (this.data.state === 'ready') {
      wx.nextTick(() => this.drawRadar())
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
      // figma 2058_12247：导航标题是角色名（狗策划），「最大价值」黑条承载 roleFields.value。
      if (definition?.name) {
        wx.setNavigationBarTitle({ title: definition.name })
      }
      const abilities = cooperationAbilityDimensions.map((dimension, index) => ({
        key: dimension.key,
        label: definition?.abilityLabels[index] || dimension.label,
        score: Number(item.abilityScores[dimension.key] || 0),
      }))
      const maxValue = String(item.roleFields.value ?? '').trim()
      const roleFields: RoleFieldView[] = []
      const support = String(item.roleFields.support ?? '').trim()
      if (support) {
        roleFields.push({ key: 'support', label: '需要支持或引荐的是', value: support })
      }
      for (const field of definition?.menu.fields || []) {
        const value = item.roleFields[field.key]
        const text = Array.isArray(value)
          ? textEntries(value).join('、')
          : String(value ?? '').trim()
        if (text) {
          roleFields.push({ key: field.key, label: field.label, value: text })
        }
      }
      const rawCircles = item.roleFields.circles
      let circles: CircleGroupView[] = []
      if (Array.isArray(rawCircles) && rawCircles.every(item => typeof item === 'string')) {
        const names = textEntries(rawCircles).join('、')
        if (names) {
          roleFields.push({ key: 'circles', label: definition?.menu.title || '长混迹的圈子', value: names })
        }
      }
      else {
        const circleEntries = normalizeCooperationCircles(rawCircles) || []
        circles = circleEntries.map(entry => ({
          name: entry.name || '',
          identity: entry.identity || '',
          years: entry.years || '',
          trait: entry.trait || '',
        }))
      }
      const quirkEntries = normalizeCooperationQuirks(item.roleFields.quirks) || []
      const quirks: QuirkGroupView[] = quirkEntries.map(entry => ({
        external: entry.external || '',
        internal: entry.internal || '',
        advice: entry.advice || '',
      }))
      this.setData({
        state: 'ready',
        item,
        abilities,
        roleFields,
        circles,
        quirks,
        maxValue,
        authorLine: authorLineOf(item),
        message: '',
      })
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
      // figma 2058_12247：雷达裸放画布，标签加大（13px），半径收一点给四周标签留白。
      const radius = Math.min(entry.width, entry.height) * 0.34
      const point = (index: number, scale: number) => {
        const angle = -Math.PI / 2 + index * Math.PI / 3
        return { x: centerX + Math.cos(angle) * radius * scale, y: centerY + Math.sin(angle) * radius * scale }
      }
      context.strokeStyle = '#4D4D4D'
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
      context.strokeStyle = '#4D4D4D'
      for (let index = 0; index < 6; index += 1) {
        const current = point(index, 1)
        context.beginPath()
        context.moveTo(centerX, centerY)
        context.lineTo(current.x, current.y)
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
      context.fillStyle = '#B3B3B3'
      context.font = '500 13px sans-serif'
      context.textBaseline = 'middle'
      this.data.abilities.forEach((ability, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 3
        const label = point(index, 1.16)
        const horizontal = Math.cos(angle)
        context.textAlign = horizontal > 0.35 ? 'left' : horizontal < -0.35 ? 'right' : 'center'
        context.fillText(ability.label, label.x, label.y)
      })
    })
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

  /** 编辑页只负责保存；草稿发布入口收敛到详情页 */
  async publish() {
    const item = this.data.item
    if (!item?.mine || item.status !== 'DRAFT' || this.data.acting) {
      return
    }
    this.setData({ acting: true, message: '' })
    try {
      const result = await cooperationModule.save({
        id: item.id,
        expectedVersion: item.version,
        roleKey: item.roleKey,
        positioning: item.positioning,
        targetSummary: item.targetSummary,
        roleFields: item.roleFields,
        abilityScores: item.abilityScores,
        publish: true,
      })
      this.setData({ 'item.status': result.status, 'item.version': result.version })
      wx.showToast({ title: '合作卡已发布', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '合作卡发布失败' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async unpublish() {
    const item = this.data.item
    if (!item?.mine || item.status !== 'PUBLISHED' || this.data.acting) {
      return
    }
    this.setData({ acting: true, message: '' })
    const confirmation = await wx.showModal({
      title: '下架合作卡',
      content: '下架后，其他用户将无法查看这张合作卡。',
      confirmText: '确认下架',
      confirmColor: '#B30516',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ acting: false })
      return
    }
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
    this.setData({ acting: true, message: '' })
    const confirmation = await wx.showModal({
      title: '删除合作卡',
      content: '删除后，这张合作卡将不再显示，且无法恢复。',
      confirmText: '删除',
      confirmColor: '#B30516',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      this.setData({ acting: false })
      return
    }
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
