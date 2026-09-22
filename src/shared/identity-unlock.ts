/**
 * journey-review J2-04（2026-09-21 走查拍板）：解锁提示弹窗。
 * 直接使用微信内置 showModal 原生形态（白底居中、标题黑、正文灰、文字按钮），
 * 不自绘、按钮不用品牌黄；正文逐字固定，不得改写或加标点。
 * 确定与取消均停留当前页，本 helper 不做任何导航，由调用方决定后续行为。
 */
export function showIdentityUnlockModal(): Promise<WechatMiniprogram.ShowModalSuccessCallbackResult> {
  return wx.showModal({
    title: '',
    content: '报名并签到任意一场MIP活动，可解锁该功能',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
  })
}
