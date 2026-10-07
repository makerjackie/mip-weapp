import type { CooperationCardId } from '../../../../modules/mip'
import type { CooperationCardDetail, CooperationRoleFieldValue } from '../../../../modules/mip-cooperation'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../../config/mip-catalogs'
import { cooperationModule, normalizeCooperationCircles, normalizeCooperationQuirks } from '../../../../modules/mip-cooperation'
import { caseNavigateTo, leaveSecondaryPage } from '../../../../platform/navigation/client'

interface AbilityView { key: string, label: string, score: number }

/** figma 2704:13454 表格模块：单元格文本直角 32px 行，列宽按设计稿换算为 rpx 模板。 */
const MENU_GRID_CIRCLES = '128rpx 128rpx 96rpx 1fr'
const MENU_GRID_FIELDS = '128rpx 160rpx 1fr'
const MENU_GRID_NAMES = '1fr'

function authorLineOf(item: CooperationCardDetail) {
  return [item.author.cityName?.trim(), item.author.primaryIndustry?.label?.trim()]
    .filter((line): line is string => Boolean(line))
    .join('丨')
}

function textEntries(value: CooperationRoleFieldValue | undefined) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function cellText(value: unknown) {
  const text = String(value ?? '').trim()
  return text || '—'
}

Page({
  data: {
    id: '' as CooperationCardId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as CooperationCardDetail | null,
    abilities: [] as AbilityView[],
    roleName: '',
    menuTitle: '',
    menuRows: [] as string[][],
    menuGridTemplate: MENU_GRID_FIELDS,
    quirkRows: [] as string[][],
    support: '',
    maxValue: '',
    badgeUrl: '',
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
      // figma 2704:13454：导航标题是角色名（狗策划），黑条「需要引荐」承载 roleFields.support。
      if (definition?.name) {
        wx.setNavigationBarTitle({ title: definition.name })
      }
      const abilities = cooperationAbilityDimensions.map((dimension, index) => ({
        key: dimension.key,
        label: definition?.abilityLabels[index] || dimension.label,
        score: Number(item.abilityScores[dimension.key] || 0),
      }))
      const support = String(item.roleFields.support ?? '').trim()
      const maxValue = String(item.roleFields.value ?? '').trim()

      // 菜单模块（PRD v1）：皮条客=常混迹的圈子表格，其余角色=本人的菜单字段行；
      // 历史 string 数组圈子退化为单列名单。
      const menuTitle = definition?.menu.title || ''
      let menuRows: string[][] = []
      let menuGridTemplate = MENU_GRID_FIELDS
      const rawCircles = item.roleFields.circles
      if (definition?.menu.structured === 'circles') {
        if (Array.isArray(rawCircles) && rawCircles.every(entry => typeof entry === 'string')) {
          menuGridTemplate = MENU_GRID_NAMES
          menuRows = textEntries(rawCircles).map(name => [name])
        }
        else {
          const entries = (normalizeCooperationCircles(rawCircles) || [])
            .filter(entry => entry.name || entry.identity || entry.years || entry.trait)
          if (entries.length) {
            menuRows = [
              ['圈子名称', '圈内身份', '圈内年限', '圈子特点'],
              ...entries.map(entry => [cellText(entry.name), cellText(entry.identity), cellText(entry.years), cellText(entry.trait)]),
            ]
            menuGridTemplate = MENU_GRID_CIRCLES
          }
        }
      }
      else {
        const values = (definition?.menu.fields || []).map((field) => {
          const value = item.roleFields[field.key]
          const text = Array.isArray(value) ? textEntries(value).join('、') : String(value ?? '').trim()
          return text
        })
        if (values.some(Boolean)) {
          menuRows = [
            (definition?.menu.fields || []).map(field => field.label),
            values.map(value => value || '—'),
          ]
        }
      }

      const quirkEntries = normalizeCooperationQuirks(item.roleFields.quirks) || []
      const quirkRows: string[][] = quirkEntries.length
        ? [
            ['臭毛病(外显)', '病因(内在)', '预防发作建议(行为)'],
            ...quirkEntries.map(entry => [cellText(entry.external), cellText(entry.internal), cellText(entry.advice)]),
          ]
        : []

      this.setData({
        state: 'ready',
        item,
        abilities,
        roleName: definition?.name || '合作角色',
        menuTitle,
        menuRows,
        menuGridTemplate,
        quirkRows,
        support,
        maxValue,
        badgeUrl: item.author.badge?.imageUrl || '',
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
      // figma 2704:13454：雷达裸放画布（290px 高），标签 fs12 白色，半径收一点给四周标签留白。
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
      context.fillStyle = '#FFFFFF'
      context.font = '500 12px sans-serif'
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

  edit() {
    if (this.data.item?.canEdit) {
      caseNavigateTo({ url: `/packages/member/mip-cooperation/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  /** 编辑页只负责保存；草稿发布入口收敛到详情页 */
  async publish() {
    const item = this.data.item
    if (!item?.mine || item.status === 'PUBLISHED' || this.data.acting) {
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

  /** 本人态长按烘焙卡：原生操作单删除（设计稿无删除入口，产品决策收敛到长按）。 */
  async onCardLongPress() {
    const item = this.data.item
    if (!item?.mine || this.data.acting) {
      return
    }
    const sheet = await wx.showActionSheet({ itemList: ['删除合作卡'], itemColor: '#B30516' }).catch(() => null)
    if (!sheet) {
      return
    }
    await this.deleteCard()
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
