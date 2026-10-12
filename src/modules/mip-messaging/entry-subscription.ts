import { mipMessagingModule } from './client'
import {
  evaluateSubscriptionGuide,
  GUIDE_RECORD_STORAGE_KEY,
  normalizeGuideRecord,
  recordGuideDecision,
  recordGuideShown,
} from './guide-policy'

/**
 * 业务按钮 tap 手势内的前置订阅授权（MIW-77 口径，DESIGN「订阅提醒跟随业务场景展示」）：
 * 不做开屏弹层、不做常驻页面模块；原生订阅面板只在用户点击的业务按钮手势内同步拉起
 * （发布机会、活动报名、心动值入口）。展示节奏复用 guide-policy：同一动作键 24h 一次；
 * 软拒绝 24h 后重问（入口没有手动开启兜底按钮）；ACCEPTED（已入账）与 BANNED（总是拒绝）
 * 后静默跳过。面板拉起失败或被拒绝不拦截业务动作——订阅授权是可选 adapter，
 * 缺授权只影响微信补充送达，站内信照常落库。
 */
export async function requestEntrySubscription(templateKey: string, actionKey: string): Promise<void> {
  // 调用方一律 void 直发（tap 手势内）：整函数不外抛——授权是可选增强，
  // 节奏回读或面板拉起的任何失败都不影响随后的业务动作。
  try {
    if (!mipMessagingModule.subscriptionCapability(templateKey).available) {
      return
    }
    const record = normalizeGuideRecord(wx.getStorageSync(GUIDE_RECORD_STORAGE_KEY))
    const outcome = evaluateSubscriptionGuide(record, {
      templateKey,
      opportunityId: actionKey,
      now: Date.now(),
      capabilityAvailable: true,
      rejectionCap: Number.MAX_SAFE_INTEGER,
    })
    if (outcome.presentation === 'HIDDEN') {
      return
    }
    // 先记展示节奏再拉面板：面板中途失败也保持 24h 一次，不连环打扰。
    const shown = recordGuideShown(record, actionKey, Date.now())
    wx.setStorageSync(GUIDE_RECORD_STORAGE_KEY, shown)
    const result = await mipMessagingModule.requestWechatSubscription(templateKey)
    wx.setStorageSync(GUIDE_RECORD_STORAGE_KEY, recordGuideDecision(shown, templateKey, result.decision))
  }
  catch {
    // 静默收敛：失败只意味着本次没拉起面板，不影响发布/报名/进入心动值。
  }
}
