import type { OpportunityId } from '../../../../modules/mip'
import type { OpportunityDetail } from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipAccessPageUrl } from '../../../../modules/mip-identity'
import { mipIdentityModule } from '../../../../modules/mip-identity/client'
import { GUIDE_PENDING_STORAGE_KEY, readPendingGuideOpportunity } from '../../../../modules/mip-messaging/guide-policy'
import {
  journeyStatusOf,
  opportunityModule,
  opportunityTypeLabel,
} from '../../../../modules/mip-opportunities'
import { caseNavigateTo } from '../../../../platform/navigation/client'
import { formatLocalDateTime } from '../../../../utils/date'

/**
 * journey-review J4-05/J4-06：发布人底部条形态。
 * draft=草稿（未发布过）、unpublished=已下架（分享置灰）、active=招募中、ended=已结束。
 */
type OwnerBarMode = 'draft' | 'unpublished' | 'active' | 'ended'

Page({
  data: {
    id: '' as OpportunityId,
    state: 'loading' as 'loading' | 'ready' | 'error',
    item: null as OpportunityDetail | null,
    publishedText: '',
    typeTagViews: [] as Array<{ key: string, label: string }>,
    /** journey-review J4-06：已下架态（服务端 DRAFT+publishedAt 的呈现）。 */
    journeyStatus: 'DRAFT' as ReturnType<typeof journeyStatusOf>,
    ownerBar: '' as '' | OwnerBarMode,
    cooperationAvatars: [] as string[],
    roleNames: [] as string[],
    message: '',
    acting: false,
    // figma 1768_37414/1768_37369 机会详情还原态开关，fixture 专用；
    // 生产保持 skeleton+卡片+介绍布局（opportunity-detail 测试 pin）。
    figmaLayout: false,
  },
  resumeInteraction: '' as '' | 'cooperation',

  onLoad(options: Record<string, string | undefined>) {
    const id = String(options.id || '') as OpportunityId
    this.setData({ id })
    void this.load()
  },

  onShow() {
    const resume = mipIdentityModule.consumePendingResume('packages/member/mip-opportunities/detail/index')
    const interaction = this.resumeInteraction
    if (resume?.action === 'INTERACT' && interaction) {
      this.resumeInteraction = ''
      void this.performInteraction()
    }
    else if (interaction) {
      this.resumeInteraction = ''
    }
    if (this.data.item) {
      void this.load()
    }
  },

  async load() {
    if (!this.data.id) {
      this.setData({ state: 'error', message: '机会信息不完整' })
      return
    }
    if (!this.data.item) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const item = await opportunityModule.get(this.data.id)
      const journeyStatus = journeyStatusOf(item)
      const ownerBar: '' | OwnerBarMode = !item.mine
        ? ''
        : journeyStatus === 'UNPUBLISHED'
          ? 'unpublished'
          : journeyStatus === 'ENDED' ? 'ended' : journeyStatus === 'DRAFT' ? 'draft' : 'active'
      this.setData({
        state: 'ready',
        item,
        publishedText: formatLocalDateTime(item.publishedAt),
        // figma 1768_37369：找资源/找企业/找伙伴发布时单选，详情只挂一个类型标签。
        typeTagViews: (item.typeKeys || []).slice(0, 1).map(key => ({ key, label: opportunityTypeLabel(key) })),
        journeyStatus,
        ownerBar,
        // 运行时验收（2026-09-22）：服务端 avatars 形状不可信，保底数组后才绑给卡片 type: Array 属性。
        cooperationAvatars: Array.isArray(item.avatars) ? item.avatars.filter(v => typeof v === 'string' && v) : [],
        roleNames: item.roles.map(key => cooperationRoles.find(role => role.key === key)?.name || key),
        message: '',
      })
      this.checkSubscriptionGuide()
    }
    catch (error) {
      this.setData(this.data.item
        ? { message: '机会更新失败，已保留上次结果。' }
        : { state: 'error', message: error instanceof Error ? error.message : '机会加载失败' })
    }
  },

  async authorizeInteraction() {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.resumeInteraction = 'cooperation'
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
      this.resumeInteraction = ''
      this.setData({ acting: false })
      await this.performInteraction()
    }
    catch {
      this.resumeInteraction = ''
      wx.showToast({ title: '身份状态暂时无法确认', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  async performInteraction() {
    const item = this.data.item
    if (!item || this.data.acting) {
      return
    }
    this.setData({ acting: true })
    try {
      const result = await opportunityModule.setCooperation(item.id, !item.cooperationActive)
      this.setData({ 'item.cooperationActive': result.active })
      wx.showToast({ title: result.active ? '已表达合作意向' : '已取消合作意向', icon: 'none' })
      await this.load()
    }
    catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
    finally {
      this.setData({ acting: false })
    }
  },

  // G1（审计 2026-10-09，figma 1769_37984）：「+N想合作」胶囊改为跳转独立二级页
  // 「想跟TA合作」（2 列竖版人才卡，服务端 activated_at DESC 最新在前），
  // 取代旧底部弹层；数据仍走现有合作名单接口（服务端可见性/登录校验不变）。
  openCooperators() {
    caseNavigateTo({ url: `/packages/member/mip-opportunity-cooperators/index?id=${encodeURIComponent(this.data.id)}` })
  },

  edit() {
    const item = this.data.item
    // 服务端 OWNER_EDITABLE 只含 DRAFT/PUBLISHED：已结束机会的「编辑」置灰，这里兜底不跳转。
    if (item && item.status !== 'ENDED' && (item.canEdit || item.mine)) {
      caseNavigateTo({ url: `/packages/member/mip-opportunities/editor/index?id=${encodeURIComponent(this.data.id)}` })
    }
  },

  /**
   * MIW-40 订阅授权引导层（发布人侧）：仅在 item.mine 时检查；组件内部还有
   * 模板/节奏门控（guide-policy）。两个时机都顺延到当前动作完成后：
   * 详情加载完成（S1，编辑返回与「想跟TA合作」页返回经 onShow→load 复用，S2）。
   * G1 后名单是独立页面，页内弹层关闭时机（S3）随之移除——从名单页返回走 S2。
   * 引导层非原生面板，无需手势上下文；原生面板只在层内按钮 tap 中触发。
   * S8：发布成功 redirectTo 详情（无上级页面）时本页是落地页——只清 pending，
   * 展示沿用 S1 检查，避免同一机会连续弹两次。
   */
  checkSubscriptionGuide() {
    if (readPendingGuideOpportunity(wx.getStorageSync(GUIDE_PENDING_STORAGE_KEY), Date.now())) {
      wx.removeStorageSync(GUIDE_PENDING_STORAGE_KEY)
    }
    if (!this.data.item?.mine) {
      return
    }
    this.selectComponent('#opportunity-subscribe-guide')?.check()
  },

  async cooperationIntent() {
    await this.authorizeInteraction()
  },

  onShareAppMessage() {
    return {
      title: this.data.item?.title || 'MIP 机会',
      path: `/packages/member/mip-opportunities/detail/index?id=${this.data.id}`,
    }
  },
})
