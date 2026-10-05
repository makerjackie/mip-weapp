import { mipMessagingModule } from '../../modules/mip-messaging/client'
import {
  createEmptyGuideRecord,
  evaluateSubscriptionGuide,
  normalizeGuideRecord,
  recordGuideDecision,
  recordGuideShown,
} from '../../modules/mip-messaging/guide-policy'

const GUIDE_STORAGE_KEY = 'mip:opportunity-subscribe-guide:v1'

/**
 * 订阅授权两段式引导层（MIW-40，机会发布人侧）。
 * check() 只弹/收引导层，无手势要求；wx.requestSubscribeMessage 的原生面板
 * 仅在「开启提醒」按钮 tap 手势内触发（平台手势约束，见 mip-subscription-prompt）。
 * 展示节奏（同一机会 24h 一次、REJECTED 累计 3 次封顶、BANNED/已入账隐藏）
 * 由 guide-policy 判定；模板未配置（TEMPLATE_MISSING）时整层不渲染（S7）。
 * 服务端 mip_notification_grants 是授权额度唯一事实源（D4）；
 * 手动开启走纯文案引导，服务端无法为手动开启入账（平台限制）。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    templateKey: { type: String, value: 'OPPORTUNITY_NOTICE' },
    opportunityId: { type: String, value: '' },
  },
  data: {
    visible: false,
    mode: '' as '' | 'REQUEST' | 'MANUAL',
    requesting: false,
    message: '',
    /** 节奏记录（非渲染状态）：实例内工作副本，attached 回读、变更整对象替换并直写 storage。 */
    record: createEmptyGuideRecord(),
  },
  lifetimes: {
    attached() {
      this.data.record = normalizeGuideRecord(wx.getStorageSync(GUIDE_STORAGE_KEY))
    },
  },
  methods: {
    /**
     * S1/S2/S3：页面在详情加载完成后、编辑返回（onShow→load 复用）、
     * 想合作名单弹层关闭后调用；时机全部顺延到当前动作完成之后。
     * S8（发布时机）：列表页传入刚发布的机会 ID 覆盖 property（列表场景无单条详情 ID），
     * 节奏键仍是同一机会 ID，列表弹过 24h 内进详情不再重复。
     */
    check(opportunityId?: string) {
      const key = (opportunityId || '').trim() || this.data.opportunityId.trim()
      if (!key || this.data.requesting) {
        return
      }
      const outcome = evaluateSubscriptionGuide(this.data.record, {
        templateKey: this.data.templateKey,
        opportunityId: key,
        now: Date.now(),
        capabilityAvailable: mipMessagingModule.subscriptionCapability(this.data.templateKey).available,
      })
      if (outcome.presentation === 'HIDDEN') {
        this.setData({ visible: false, mode: '', message: '' })
        return
      }
      this.data.record = recordGuideShown(this.data.record, key, Date.now())
      wx.setStorageSync(GUIDE_STORAGE_KEY, this.data.record)
      this.setData({ visible: true, mode: outcome.presentation, message: '' })
    },

    /** S4/S5/S6：原生面板入口；REJECTED 就地切手动开启文案，ACCEPTED/BANNED 收层。 */
    async request() {
      if (this.data.mode !== 'REQUEST' || this.data.requesting) {
        return
      }
      this.setData({ requesting: true, message: '' })
      try {
        const result = await mipMessagingModule.requestWechatSubscription(this.data.templateKey)
        this.data.record = recordGuideDecision(this.data.record, this.data.templateKey, result.decision)
        wx.setStorageSync(GUIDE_STORAGE_KEY, this.data.record)
        if (result.decision === 'REJECTED') {
          this.setData({ mode: 'MANUAL' })
          return
        }
        wx.showToast({ title: result.decision === 'ACCEPTED' ? '已开启机会动态提醒' : '已关闭机会动态提醒', icon: 'none' })
        this.setData({ visible: false, mode: '' })
      }
      catch {
        this.setData({ message: '提醒暂时未能开启，可稍后重试。' })
      }
      finally {
        this.setData({ requesting: false })
      }
    },

    dismiss() {
      this.setData({ visible: false, mode: '', message: '' })
    },

    onVisibleChange(event: WechatMiniprogram.CustomEvent<{ visible?: boolean }>) {
      if (!event.detail.visible) {
        this.dismiss()
      }
    },
  },
})
