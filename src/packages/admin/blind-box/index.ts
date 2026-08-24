import type {
  BlindBoxCardAdmin,
  BlindBoxCatalogAdmin,
  BlindBoxRarity,
} from '../../../modules/mip-game'
import { mipGameModule } from '../../../modules/mip-game'

const rarityOptions: Array<{ label: string, value: BlindBoxRarity }> = [
  { label: '普通', value: 'COMMON' },
  { label: '稀有', value: 'RARE' },
  { label: '史诗', value: 'EPIC' },
  { label: '传说', value: 'LEGENDARY' },
]

type BlindBoxCatalogView = BlindBoxCatalogAdmin & { statusLabel: string }
type BlindBoxCardView = BlindBoxCardAdmin & { rarityLabel: string, statusLabel: string }

function statusLabel(status: BlindBoxCatalogAdmin['status']) {
  return status === 'PUBLISHED' ? '已发布' : status === 'UNPUBLISHED' ? '已下架' : '草稿'
}

function catalogView(item: BlindBoxCatalogAdmin): BlindBoxCatalogView {
  return { ...item, statusLabel: statusLabel(item.status) }
}

function cardView(item: BlindBoxCardAdmin): BlindBoxCardView {
  return {
    ...item,
    rarityLabel: rarityOptions.find(option => option.value === item.rarity)?.label || item.rarity,
    statusLabel: statusLabel(item.status),
  }
}

function numeric(value: string) {
  return Number(value.trim())
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden',
    catalogs: [] as BlindBoxCatalogView[],
    selectedCatalogId: '',
    cards: [] as BlindBoxCardView[],
    rarityOptions,
    catalogEditorOpen: false,
    catalogId: '',
    catalogVersion: 0,
    catalogKey: '',
    catalogName: '',
    catalogSummary: '',
    rulesText: '',
    redemptionRulesText: '',
    drawCostCoin: '5',
    dailyDrawLimit: '20',
    pityThreshold: '10',
    pityMinRarityIndex: 1,
    cardEditorOpen: false,
    cardId: '',
    cardVersion: 0,
    cardKey: '',
    cardName: '',
    cardSummary: '',
    cardRarityIndex: 0,
    cardWeight: '7000',
    stockTotal: '100',
    displayOrder: '0',
    processing: false,
    message: '',
  },

  onShow() {
    void this.load()
  },
  async onPullDownRefresh() {
    try {
      await this.load()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      await mipGameModule.gateway.getAdminSession()
      const result = await mipGameModule.gateway.adminListBlindBoxCatalogs()
      const selectedCatalogId = this.data.selectedCatalogId
        && result.items.some(item => item.id === this.data.selectedCatalogId)
        ? this.data.selectedCatalogId
        : (result.items[0]?.id || '')
      this.setData({ catalogs: result.items.map(catalogView), selectedCatalogId, state: 'ready' })
      await this.loadCards()
    }
    catch (error) {
      const code = (error as { code?: string })?.code
      this.setData({
        state: code === 'FORBIDDEN' ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : '盲盒管理加载失败',
      })
    }
  },

  async loadCards() {
    if (!this.data.selectedCatalogId) {
      this.setData({ cards: [] })
      return
    }
    const result = await mipGameModule.gateway.adminListBlindBoxCards(this.data.selectedCatalogId)
    this.setData({ cards: result.items.map(cardView) })
  },

  async chooseCatalog(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedCatalogId: String(event.currentTarget.dataset.id || ''), message: '' })
    try {
      await this.loadCards()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '卡牌目录加载失败' })
    }
  },

  openCreateCatalog() {
    this.setData({
      catalogEditorOpen: true,
      catalogId: '',
      catalogVersion: 0,
      catalogKey: '',
      catalogName: '',
      catalogSummary: '',
      rulesText: '每次抽取由服务端按已发布概率和库存生成结果。',
      redemptionRulesText: '兑换规则以当前发布内容为准。',
      drawCostCoin: '5',
      dailyDrawLimit: '20',
      pityThreshold: '10',
      pityMinRarityIndex: 1,
      message: '',
    })
  },

  editCatalog(event: WechatMiniprogram.TouchEvent) {
    const catalog = this.data.catalogs.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!catalog) {
      return
    }
    this.setData({
      catalogEditorOpen: true,
      catalogId: catalog.id,
      catalogVersion: catalog.version,
      catalogKey: catalog.catalogKey,
      catalogName: catalog.name,
      catalogSummary: catalog.summary,
      rulesText: catalog.rulesText,
      redemptionRulesText: catalog.redemptionRulesText,
      drawCostCoin: String(catalog.drawCostCoin),
      dailyDrawLimit: String(catalog.dailyDrawLimit),
      pityThreshold: String(catalog.pityThreshold),
      pityMinRarityIndex: Math.max(0, rarityOptions.findIndex(item => item.value === catalog.pityMinRarity)),
      message: '',
    })
  },

  closeCatalogEditor() {
    this.setData({ catalogEditorOpen: false })
  },

  updateCatalogField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = [
      'catalogKey',
      'catalogName',
      'catalogSummary',
      'rulesText',
      'redemptionRulesText',
      'drawCostCoin',
      'dailyDrawLimit',
      'pityThreshold',
    ]
    if (allowed.includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  choosePityRarity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ pityMinRarityIndex: Number(event.detail.value) })
  },

  async saveCatalog() {
    if (this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const saved = await mipGameModule.gateway.adminSaveBlindBoxCatalog({
        catalogId: this.data.catalogId || undefined,
        expectedVersion: this.data.catalogId ? this.data.catalogVersion : undefined,
        catalog: {
          catalogKey: this.data.catalogKey,
          name: this.data.catalogName,
          summary: this.data.catalogSummary,
          rulesText: this.data.rulesText,
          redemptionRulesText: this.data.redemptionRulesText,
          drawCostCoin: numeric(this.data.drawCostCoin),
          dailyDrawLimit: numeric(this.data.dailyDrawLimit),
          pityThreshold: numeric(this.data.pityThreshold),
          pityMinRarity: rarityOptions[this.data.pityMinRarityIndex].value,
        },
      })
      this.setData({ catalogEditorOpen: false, selectedCatalogId: saved.id })
      wx.showToast({ title: '目录已保存', icon: 'success' })
      await this.load()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '目录保存失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async changeCatalogStatus(event: WechatMiniprogram.TouchEvent) {
    const catalog = this.data.catalogs.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    const status = String(event.currentTarget.dataset.status || '') as 'PUBLISHED' | 'UNPUBLISHED'
    if (!catalog || this.data.processing || !['PUBLISHED', 'UNPUBLISHED'].includes(status)) {
      return
    }
    const modal = await wx.showModal({
      title: status === 'PUBLISHED' ? '发布盲盒' : '下架盲盒',
      content: status === 'PUBLISHED' ? '发布后玩家可以查看并抽取。' : '下架后停止新的抽取，已有背包记录保留。',
    })
    if (!modal.confirm) {
      return
    }
    await this.runMutation(async () => {
      await mipGameModule.gateway.adminChangeBlindBoxCatalogStatus(catalog.id, catalog.version, status)
      await this.load()
    }, '目录状态更新失败')
  },

  openCreateCard() {
    if (!this.data.selectedCatalogId) {
      return
    }
    this.setData({
      cardEditorOpen: true,
      cardId: '',
      cardVersion: 0,
      cardKey: '',
      cardName: '',
      cardSummary: '',
      cardRarityIndex: 0,
      cardWeight: '7000',
      stockTotal: '100',
      displayOrder: '0',
      message: '',
    })
  },

  editCard(event: WechatMiniprogram.TouchEvent) {
    const card = this.data.cards.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!card) {
      return
    }
    this.setData({
      cardEditorOpen: true,
      cardId: card.id,
      cardVersion: card.version,
      cardKey: card.cardKey,
      cardName: card.name,
      cardSummary: card.summary,
      cardRarityIndex: Math.max(0, rarityOptions.findIndex(item => item.value === card.rarity)),
      cardWeight: String(card.weight),
      stockTotal: String(card.stockTotal),
      displayOrder: String(card.displayOrder),
      message: '',
    })
  },

  closeCardEditor() {
    this.setData({ cardEditorOpen: false })
  },

  updateCardField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = ['cardKey', 'cardName', 'cardSummary', 'cardWeight', 'stockTotal', 'displayOrder']
    if (allowed.includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  chooseCardRarity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cardRarityIndex = Number(event.detail.value)
    const defaults: Record<BlindBoxRarity, string> = {
      COMMON: '7000',
      RARE: '2200',
      EPIC: '700',
      LEGENDARY: '100',
    }
    this.setData({
      cardRarityIndex,
      ...(!this.data.cardId ? { cardWeight: defaults[rarityOptions[cardRarityIndex].value] } : {}),
    })
  },

  async saveCard() {
    if (this.data.processing || !this.data.selectedCatalogId) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipGameModule.gateway.adminSaveBlindBoxCard({
        cardId: this.data.cardId || undefined,
        expectedVersion: this.data.cardId ? this.data.cardVersion : undefined,
        card: {
          catalogId: this.data.selectedCatalogId,
          cardKey: this.data.cardKey,
          name: this.data.cardName,
          summary: this.data.cardSummary,
          rarity: rarityOptions[this.data.cardRarityIndex].value,
          weight: numeric(this.data.cardWeight),
          stockTotal: numeric(this.data.stockTotal),
          displayOrder: numeric(this.data.displayOrder),
        },
      })
      this.setData({ cardEditorOpen: false })
      wx.showToast({ title: '卡牌已保存', icon: 'success' })
      await this.loadCards()
      const catalogs = await mipGameModule.gateway.adminListBlindBoxCatalogs()
      this.setData({ catalogs: catalogs.items.map(catalogView) })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '卡牌保存失败' })
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async changeCardStatus(event: WechatMiniprogram.TouchEvent) {
    const card = this.data.cards.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    const status = String(event.currentTarget.dataset.status || '') as 'PUBLISHED' | 'UNPUBLISHED'
    if (!card || this.data.processing || !['PUBLISHED', 'UNPUBLISHED'].includes(status)) {
      return
    }
    await this.runMutation(async () => {
      await mipGameModule.gateway.adminChangeBlindBoxCardStatus(card.id, card.version, status)
      await this.loadCards()
    }, '卡牌状态更新失败')
  },

  async runMutation(work: () => Promise<void>, fallback: string) {
    this.setData({ processing: true, message: '' })
    try {
      await work()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : fallback })
    }
    finally {
      this.setData({ processing: false })
    }
  },
})

export const _blindBoxAdminTest = { cardView, catalogView, numeric, rarityOptions }
