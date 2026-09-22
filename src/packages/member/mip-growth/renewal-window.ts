/**
 * journey-review J4-03（figma 2165:17142 标注）：「立即续费」仅到期前 3 个月展示。
 * 到期时间本身是服务端会员事实（mip-commerce membershipEndsAt），这里只做展示窗口换算。
 */
const RENEWAL_WINDOW_MONTHS = 3

/**
 * setMonth 直接减月会在月末进位（5/31 − 3 个月落到 3/3 而不是 2/28），
 * 所以先退回当月 1 号，再钳制到目标月的最后一天。
 */
export function withinRenewalWindow(endsAt: string, now = new Date()) {
  const end = new Date(endsAt)
  if (Number.isNaN(end.getTime())) {
    return false
  }
  const endDay = end.getDate()
  const opensAt = new Date(end)
  opensAt.setDate(1)
  opensAt.setMonth(opensAt.getMonth() - RENEWAL_WINDOW_MONTHS)
  const lastDayOfTargetMonth = new Date(opensAt.getFullYear(), opensAt.getMonth() + 1, 0).getDate()
  opensAt.setDate(Math.min(endDay, lastDayOfTargetMonth))
  return now >= opensAt && now <= end
}
