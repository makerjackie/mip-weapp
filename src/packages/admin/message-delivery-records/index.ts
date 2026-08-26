import type {
  AdminMessageDeliveryRecord,
  AdminMessageDeliveryRecordChannel,
  AdminMessageDeliveryRecordStatus,
} from '../../../modules/mip-admin/message-delivery-records'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { localDayBoundary } from '../../../modules/mip-admin/message-delivery-records'
import { formatLocalDateTime } from '../../../utils/date'
import { adminLoadFailure, isAdminForbiddenError } from '../shared/page-state'

type ViewItem = AdminMessageDeliveryRecord & {
  channelText: string
  statusText: string
  occurredText: string
  availableText: string
  deliveredText: string
  createdText: string
  errorText: string
  recipientText: string
}

const channelLabels: Record<AdminMessageDeliveryRecordChannel, string> = {
  WECHAT_SUBSCRIPTION: '微信订阅消息',
  WECHAT_CUSTOMER_SERVICE: '微信客服消息',
  WECHAT_SERVICE_ACCOUNT: '微信服务通知',
}
const statusLabels: Record<AdminMessageDeliveryRecordStatus, string> = {
  PENDING: '等待处理',
  PROCESSING: '处理中',
  DELIVERED: '已送达',
  FAILED: '失败',
  CANCELLED: '已取消',
}
const pageSizes = [10, 20, 50, 100]

function viewItem(item: AdminMessageDeliveryRecord): ViewItem {
  return {
    ...item,
    channelText: channelLabels[item.channel],
    statusText: statusLabels[item.status],
    occurredText: formatLocalDateTime(item.occurredAt),
    availableText: item.availableAt ? formatLocalDateTime(item.availableAt) : '未记录',
    deliveredText: item.deliveredAt ? formatLocalDateTime(item.deliveredAt) : '未送达',
    createdText: item.createdAt ? formatLocalDateTime(item.createdAt) : '未记录',
    errorText: item.lastErrorCode || '无',
    recipientText: item.playerNumber ? `${item.nickname} · 玩家编号 ${item.playerNumber}` : item.nickname,
  }
}

Page({
  data: {
    state: 'loading' as AdminPageState | 'empty',
    items: [] as ViewItem[],
    query: '',
    channel: '' as AdminMessageDeliveryRecordChannel | '',
    status: '' as AdminMessageDeliveryRecordStatus | '',
    from: '',
    to: '',
    pageSize: 20,
    pageSizeIndex: 1,
    nextCursor: null as string | null,
    loadingMore: false,
    message: '',
    pageSizes,
  },

  onShow() {
    void this.load()
  },

  async onPullDownRefresh() {
    try {
      await this.load(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  updateQuery(event: WechatMiniprogram.Input) {
    this.setData({ query: String(event.detail.value || '') })
  },

  chooseChannel(event: WechatMiniprogram.PickerChange) {
    const values = ['', 'WECHAT_SUBSCRIPTION', 'WECHAT_CUSTOMER_SERVICE', 'WECHAT_SERVICE_ACCOUNT']
    this.setData({ channel: values[Number(event.detail.value)] as AdminMessageDeliveryRecordChannel | '' })
    void this.load(true)
  },

  chooseStatus(event: WechatMiniprogram.PickerChange) {
    const values = ['', 'PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'CANCELLED']
    this.setData({ status: values[Number(event.detail.value)] as AdminMessageDeliveryRecordStatus | '' })
    void this.load(true)
  },

  choosePageSize(event: WechatMiniprogram.PickerChange) {
    const pageSizeIndex = Number(event.detail.value)
    this.setData({ pageSize: pageSizes[pageSizeIndex] || 20, pageSizeIndex })
    void this.load(true)
  },

  chooseFrom(event: WechatMiniprogram.PickerChange) {
    this.setData({ from: String(event.detail.value || '') })
    void this.load(true)
  },

  chooseTo(event: WechatMiniprogram.PickerChange) {
    this.setData({ to: String(event.detail.value || '') })
    void this.load(true)
  },

  submitQuery() {
    void this.load(true)
  },

  retryLoad() {
    void this.load(true)
  },

  loadMore() {
    if (this.data.nextCursor && !this.data.loadingMore) {
      void this.loadMorePage()
    }
  },

  async load(force = false) {
    const session = await mipAdminModule.getSession(force)
    if (!session.enabled || !hasCapability(session.capabilities, 'messages.manage')) {
      this.setData({ state: 'forbidden', items: [], message: '' })
      return false
    }
    this.setData({ state: 'loading', nextCursor: null, message: '' })
    try {
      const page = await mipAdminModule.messaging.listDeliveryRecords({
        query: this.data.query.trim() || undefined,
        channel: this.data.channel || undefined,
        status: this.data.status || undefined,
        from: this.data.from ? localDayBoundary(this.data.from) : undefined,
        to: this.data.to ? localDayBoundary(this.data.to, 1) : undefined,
        limit: this.data.pageSize,
      }, force)
      this.setData({
        state: page.items.length ? 'ready' : 'empty',
        items: page.items.map(viewItem),
        nextCursor: page.nextCursor,
      })
      return true
    }
    catch (error) {
      if (isAdminForbiddenError(error)) {
        this.setData({ state: 'forbidden', items: [] })
      }
      else { this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '消息投递记录加载失败' })) }
      return false
    }
  },

  async loadMorePage() {
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipAdminModule.messaging.listDeliveryRecords({
        query: this.data.query.trim() || undefined,
        channel: this.data.channel || undefined,
        status: this.data.status || undefined,
        from: this.data.from ? localDayBoundary(this.data.from) : undefined,
        to: this.data.to ? localDayBoundary(this.data.to, 1) : undefined,
        limit: this.data.pageSize,
        cursor: this.data.nextCursor || undefined,
      }, true)
      this.setData({
        state: 'ready',
        items: this.data.items.concat(page.items.map(viewItem)),
        nextCursor: page.nextCursor,
        loadingMore: false,
      })
    }
    catch (error) {
      this.setData({ loadingMore: false, message: isAdminForbiddenError(error) ? '当前账号不能查看消息投递记录。' : '更多记录加载失败' })
    }
  },
})
