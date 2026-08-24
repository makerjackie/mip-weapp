import type { AdminTaskCompletion, TaskCompletionResult } from '../../../modules/mip-tasks'
import { mipTasksModule } from '../../../modules/mip-tasks'

interface CompletionView extends AdminTaskCompletion {
  completedText: string
  resultText: string
  attachmentSizeText: string
}

function dateTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ''
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function completionView(item: AdminTaskCompletion): CompletionView {
  return {
    ...item,
    completedText: dateTime(item.completedAt),
    resultText: item.resultStatus === 'SUCCESS' ? '成功' : '失败',
    attachmentSizeText: item.attachment ? `${Math.max(1, Math.ceil(item.attachment.bytes / 1024))} KB` : '',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error' | 'forbidden',
    items: [] as CompletionView[],
    selected: null as CompletionView | null,
    taskId: '',
    query: '',
    resultStatus: '' as TaskCompletionResult | '',
    completedFrom: '',
    completedUntil: '',
    nextCursor: '',
    loadingMore: false,
    exporting: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ taskId: String(options.taskId || '') })
  },

  onShow() { void this.loadCompletions() },

  async onPullDownRefresh() {
    try {
      await this.loadCompletions()
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  filters() {
    return {
      taskId: this.data.taskId || undefined,
      query: this.data.query || undefined,
      resultStatus: this.data.resultStatus,
      completedFrom: this.data.completedFrom ? `${this.data.completedFrom}T00:00:00+08:00` : undefined,
      completedUntil: this.data.completedUntil ? `${this.data.completedUntil}T23:59:59.999+08:00` : undefined,
    }
  },

  async loadCompletions() {
    if (!this.data.items.length) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const page = await mipTasksModule.gateway.listCompletions(this.filters(), undefined, 20)
      const items = page.items.map(completionView)
      this.setData({
        state: items.length ? 'ready' : 'empty',
        items,
        selected: null,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      const code = (error as { code?: string })?.code
      this.setData({
        state: code === 'FORBIDDEN' ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : '任务流水加载失败',
      })
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  chooseResult(event: WechatMiniprogram.TouchEvent) {
    this.setData({ resultStatus: String(event.currentTarget.dataset.value || '') as TaskCompletionResult | '' })
    void this.loadCompletions()
  },
  chooseFrom(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ completedFrom: event.detail.value }) },
  chooseUntil(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ completedUntil: event.detail.value }) },
  clearFilters() {
    this.setData({ taskId: '', query: '', resultStatus: '', completedFrom: '', completedUntil: '' })
    void this.loadCompletions()
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipTasksModule.gateway.listCompletions(this.filters(), this.data.nextCursor, 20)
      this.setData({
        items: this.data.items.concat(page.items.map(completionView)),
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多任务流水加载失败' })
    }
    finally { this.setData({ loadingMore: false }) }
  },

  async openDetail(event: WechatMiniprogram.TouchEvent) {
    const completionId = String(event.currentTarget.dataset.id || '')
    if (!completionId) {
      return
    }
    this.setData({ message: '' })
    try {
      this.setData({ selected: completionView(await mipTasksModule.gateway.getCompletion(completionId)) })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务流水详情加载失败' })
    }
  },

  closeDetail() { this.setData({ selected: null }) },

  async exportRows() {
    if (this.data.exporting) {
      return
    }
    this.setData({ exporting: true, message: '' })
    try {
      const result = await mipTasksModule.exportAndOpen(this.filters())
      wx.showToast({ title: `已导出 ${result.rowCount} 条`, icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '任务流水导出失败' })
    }
    finally { this.setData({ exporting: false }) }
  },
})
