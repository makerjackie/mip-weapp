import type {
  BlindBoxDetail,
  BlindBoxDrawResult,
} from '../../../../modules/mip-game'
import {
  mipGameModule,
  mipGamePendingDrawStore,
  shouldRetainPendingDraw,
} from '../../../../modules/mip-game'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'

type BlindBoxCardView = BlindBoxDetail['cards'][number] & {
  rarityLabel: string
  stockText: string
}

interface BlindBoxDetailView extends Omit<BlindBoxDetail, 'cards'> {
  cards: BlindBoxCardView[]
  pityMinRarityLabel: string
}

interface DrawResultView extends BlindBoxDrawResult {
  rarityLabel: string
  drawnText: string
}

function requestId() {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

function dateText(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function detailView(detail: BlindBoxDetail): BlindBoxDetailView {
  const rarityLabels = new Map(detail.rarities.map(item => [item.rarity, item.label]))
  return {
    ...detail,
    pityMinRarityLabel: rarityLabels.get(detail.pityMinRarity) || detail.pityMinRarity,
    cards: detail.cards.map(item => ({
      ...item,
      rarityLabel: rarityLabels.get(item.rarity) || item.rarity,
      stockText: item.stockRemaining > 0 ? `剩余 ${item.stockRemaining} 份` : '库存已用完',
    })),
  }
}

function resultView(result: BlindBoxDrawResult, detail: BlindBoxDetailView): DrawResultView {
  return {
    ...result,
    rarityLabel: detail.rarities.find(item => item.rarity === result.card.rarity)?.label || result.card.rarity,
    drawnText: dateText(result.drawnAt),
  }
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    catalogId: '',
    detail: null as BlindBoxDetailView | null,
    coinBalance: 0,
    drawing: false,
    drawStage: 'idle' as 'idle' | 'drawing' | 'result',
    drawResult: null as DrawResultView | null,
    drawRequestId: '',
    drawUserId: '',
    message: '',
  },
  active: true,

  onLoad(options: Record<string, string>) {
    this.setData({ catalogId: String(options.catalogId || '') })
    void this.restorePendingRequest()
    void this.loadDetail()
  },

  onUnload() {
    this.active = false
  },

  async onPullDownRefresh() {
    try {
      await this.loadDetail(true, true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadDetail(preserveResult = false, force = false) {
    const catalogId = this.data.catalogId
    if (!catalogId) {
      this.setData({ state: 'error', message: '盲盒参数无效。' })
      return
    }
    if (!this.data.detail) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [detail, catalogPage] = await Promise.all([
        mipGameModule.query.getBlindBox(catalogId, force),
        mipGameModule.query.listBlindBoxes(force),
      ])
      this.setData({
        state: 'ready',
        detail: detailView(detail),
        coinBalance: catalogPage.coinBalance,
        message: '',
        ...(!preserveResult ? { drawStage: 'idle', drawResult: null } : {}),
      })
    }
    catch (error) {
      this.setData(this.data.detail
        ? { message: '盲盒详情更新失败，已保留上次结果。' }
        : {
            state: 'error',
            message: error instanceof Error ? error.message : '盲盒详情加载失败',
          })
    }
  },

  async draw() {
    const detail = this.data.detail
    if (!detail || this.data.drawing || detail.stockRemaining <= 0 || this.data.coinBalance < detail.drawCostCoin) {
      return
    }
    let drawUserId = this.data.drawUserId
    let stableRequestId = this.data.drawRequestId
    try {
      const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
      drawUserId = String(snapshot.userId || '')
      if (!drawUserId) {
        throw new Error('登录状态不可用')
      }
      stableRequestId = mipGamePendingDrawStore.ensure(drawUserId, detail.id, requestId)
    }
    catch {
      this.setData({ message: '无法保存抽取请求，请重试。' })
      return
    }
    this.setData({
      drawing: true,
      drawStage: 'drawing',
      drawResult: null,
      drawRequestId: stableRequestId,
      drawUserId,
      message: '',
    })
    const animation = wait(900)
    try {
      const result = await mipGameModule.mutation.drawBlindBox(detail.id, stableRequestId)
      try {
        mipGamePendingDrawStore.clear(drawUserId, detail.id, stableRequestId)
      }
      catch {}
      await animation
      if (!this.active) {
        return
      }
      this.setData({
        drawing: false,
        drawStage: 'result',
        drawResult: resultView(result, detail),
        drawRequestId: '',
        coinBalance: result.balanceAfter,
      })
      void this.refreshCatalogFact()
    }
    catch (error) {
      const indeterminate = shouldRetainPendingDraw(error)
      if (!indeterminate) {
        try {
          mipGamePendingDrawStore.clear(drawUserId, detail.id, stableRequestId)
        }
        catch {}
      }
      if (!this.active) {
        return
      }
      this.setData({
        drawing: false,
        drawStage: 'idle',
        ...(!indeterminate ? { drawRequestId: '' } : {}),
        message: error instanceof Error ? error.message : '抽取失败，请重试。',
      })
      void this.refreshCatalogFact()
    }
  },

  async restorePendingRequest() {
    if (!this.data.catalogId) {
      return
    }
    try {
      const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
      const drawUserId = String(snapshot.userId || '')
      if (!drawUserId || !this.active) {
        return
      }
      this.setData({
        drawUserId,
        drawRequestId: mipGamePendingDrawStore.read(drawUserId, this.data.catalogId),
      })
    }
    catch {}
  },

  async refreshCatalogFact() {
    try {
      const [detail, catalogPage] = await Promise.all([
        mipGameModule.query.getBlindBox(this.data.catalogId, true),
        mipGameModule.query.listBlindBoxes(true),
      ])
      if (this.active) {
        this.setData({ detail: detailView(detail), coinBalance: catalogPage.coinBalance })
      }
    }
    catch {}
  },

  drawAgain() {
    if (!this.data.drawing) {
      this.setData({ drawStage: 'idle', drawResult: null, message: '' })
    }
  },

  openBackpack() {
    if (this.data.catalogId) {
      void wx.navigateTo({
        url: `/packages/member/mip-blind-box/backpack/index?catalogId=${encodeURIComponent(this.data.catalogId)}`,
      })
    }
  },

  openCoinEntries() {
    void wx.navigateTo({ url: '/packages/member/mip-blind-box/coin-entries/index' })
  },
})
