import type { OperationalException } from '../../../modules/admin/types'
import { adminModule } from '../../../modules/admin/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'
import { formatLocalMonthDayTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

interface ExceptionView extends OperationalException {
  updatedText: string
  severityText: string
}

const severityLabels = {
  LOW: '提醒',
  MEDIUM: '需处理',
  HIGH: '优先处理',
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error' | 'forbidden',
    items: [] as ExceptionView[],
    retryingId: '',
    message: '',
  },

  onLoad() {
    void this.loadExceptions()
  },

  async loadExceptions(force = false) {
    const cached = adminModule.peekOperationalExceptions()
    if (cached) {
      this.applyItems(cached)
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      this.applyItems(await adminModule.listOperationalExceptions({ force }))
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '异常列表加载失败',
      }))
    }
  },

  applyItems(items: OperationalException[]) {
    this.setData({
      state: 'ready',
      items: items.map(item => ({
        ...item,
        updatedText: formatLocalMonthDayTime(item.updatedAt),
        severityText: severityLabels[item.severity],
      })),
      message: '',
    })
  },

  openItem(event: WechatMiniprogram.BaseEvent) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)]
    if (item?.route) {
      caseNavigateTo({ url: item.route })
    }
  },

  async retryItem(event: WechatMiniprogram.BaseEvent) {
    const item = this.data.items[Number(event.currentTarget.dataset.index)]
    if (!item?.canRetry || this.data.retryingId) {
      return
    }
    this.setData({ retryingId: item.id, message: '' })
    try {
      await adminModule.retryOperationalException(item)
      wx.showToast({ title: '已重新加入处理队列', icon: 'success' })
      await this.loadExceptions(true)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '重新处理失败' })
    }
    finally {
      this.setData({ retryingId: '' })
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadExceptions(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },
})
