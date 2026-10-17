import type { AdminRequest } from './admin-read-contracts'
export type ConfigurationKind = 'levels' | 'benefits' | 'rules' | 'badges'
export interface ConfigurationItem { id: string; name: string; version: number; status: string; [key: string]: unknown }
export type AgreementDocument = 'membership' | 'user' | 'privacy' | 'experience-rules'
export interface MembershipAgreement { title: string; body: string; isDemo: boolean; version: number; updatedAt: string | null }
// MIW-35：会员方案改价。名称/时长/上下架只读，后台仅允许调整 priceCents。
export interface MembershipPlan { id: string; planKey: string; catalogStage: 'TEST' | 'LIVE'; name: string; durationDays: number; priceCents: number; currency: string; status: string; version: number; updatedAt: string | null }
export const minPlanPriceCents = 1
export const maxPlanPriceCents = 100000000
export function planPriceCents(yuan: number | null): number | null {
  if (yuan === null || !Number.isFinite(yuan)) return null
  const cents = Math.round(yuan * 100)
  return Number.isSafeInteger(cents) && cents >= minPlanPriceCents && cents <= maxPlanPriceCents ? cents : null
}
export function planPriceYuan(cents: number): number {
  return Math.round(cents) / 100
}
export const demoMembershipAgreement = {
  title: '会员服务协议（演示）', isDemo: true,
  body: '【演示内容，仅供测试，不作为正式会员服务承诺】\n\n一、服务范围\n本演示会员可查看社区活动、交流资料与成长任务。具体服务、资格及有效期以后台配置和页面展示为准。\n\n二、成长与奖励\n完成任务后的经验值、贡献值和勋章，以服务端记录及管理员配置为准。演示奖励不承诺现金收益；奖金如有配置，需由运营另行核验和线下处理。\n\n三、使用规范\n请提供真实资料，尊重其他成员，不发布违法或侵权内容。\n\n四、服务调整与反馈\n此处为可编辑示例。正式上线前请替换为实际服务提供方、服务范围、退款及终止规则、联系方式等内容。',
}
export const demoUserAgreement = {
  title: '用户使用协议（演示）', isDemo: true,
  body: '【演示内容，仅供测试，不作为正式服务条款】\n\n一、服务范围\n本小程序提供资料展示、社区活动、项目机会与成长任务。具体功能以页面及管理员配置为准。\n\n二、使用规范\n请使用本人账号，尊重他人，不提交违法、侵权或泄露他人隐私的内容。\n\n三、演示配置\n标注演示的权益与奖励仅供体验，可由管理员修改。任务提交后以服务端记录及审核结果为准，不承诺现金收益。\n\n四、账号与反馈\n你可以在设置中修改资料与隐私、退出登录或申请注销；问题可通过小程序客服反馈。正式上线前请替换为确认后的服务主体、联系方式与服务条款。',
}
// MIW-121：隐私政策后台可配置；演示文案与小程序 privacy-policy 页内置兜底逐字一致。
export const demoPrivacyAgreement = {
  title: '隐私政策（演示）', isDemo: true,
  body: '【演示内容，仅供测试，不作为正式隐私政策】\n\n一、信息处理范围\n仅在使用对应功能时处理微信身份标识、你主动提交的档案与联系方式、活动与互动记录，以及订单、支付和退款状态。\n\n二、信息使用\n相关信息用于登录识别、提供会员与活动服务、处理订单、保障账号安全和响应客服请求，不用于与当前服务无关的用途。\n\n三、公开范围\n手机号、微信身份标识、订单信息和报名答案不会在公开档案中展示。档案中的可公开内容由你在公开设置中管理。\n\n四、授权与第三方服务\n手机号、支付、订阅消息、相册、录音等微信能力只在你主动操作时申请。支付与消息服务会按功能需要由微信及相应服务提供方处理。\n\n五、保存与注销\n退出登录只清除本机登录状态。注销账号后，公开资料和可撤销状态会关闭；订单、支付、退款、活动和审计记录按适用规则保留。\n\n六、你的权利\n你可以管理档案公开范围和屏蔽列表。数据副本、更正或其他隐私请求可通过小程序客服提交。正式上线前请替换为确认后的隐私政策全文。',
}
// MIW-27：经验值详情-规则详情页签展示的整段文本（membership-content 第三种文档）。
export const demoExperienceRules = {
  title: '经验值规则说明（演示）', isDemo: true,
  body: '【演示内容，仅供测试，不作为正式规则说明】\n\n一、获取方式\n完成每日签到、参加活动与成长任务可获得经验值，具体数值以管理后台配置的奖励规则为准。\n\n二、等级与权益\n经验值累计达到对应等级门槛后解锁相应等级权益；权益内容以「等级权益」配置为准。\n\n三、调整与说明\n经验值不兑现现金，不可转让；运营调整规则时不追溯改写已发放记录。正式上线前请替换为确认后的规则文案。',
}
const operations = {
  levels: { list: 'mip.admin.growth.levels', save: 'mip.admin.growth.saveLevel', id: 'levelId' },
  benefits: { list: 'mip.admin.growth.benefits', save: 'mip.admin.growth.saveBenefit', id: 'benefitId' },
  rules: { list: 'mip.admin.growth.rules', save: 'mip.admin.growth.saveRule', id: 'ruleId' },
  badges: { list: 'mip.admin.badges.list', save: 'mip.admin.badges.save', id: 'badgeId' },
} as const
export function membershipConfiguration(request: AdminRequest) {
  return {
    list: (kind: ConfigurationKind) => request<{ items: ConfigurationItem[] }>(operations[kind].list),
    save: (kind: ConfigurationKind, item: ConfigurationItem | null, draft: Record<string, unknown>, idempotencyKey: string) => request(operations[kind].save, {
      ...(item ? { [operations[kind].id]: item.id, expectedVersion: item.version } : {}), draft, idempotencyKey,
    }),
    agreement: (document: AgreementDocument = 'membership') => request<MembershipAgreement>('mip.admin.membershipAgreement.get', document === 'membership' ? undefined : { document }),
    saveAgreement: (version: number, draft: Pick<MembershipAgreement, 'title' | 'body' | 'isDemo'>, idempotencyKey: string, document: AgreementDocument = 'membership') => request('mip.admin.membershipAgreement.save', { expectedVersion: version, draft, idempotencyKey, ...(document === 'membership' ? {} : { document }) }),
    plans: () => request<{ items: MembershipPlan[] }>('mip.admin.membershipPlans.list'),
    savePlanPrice: (planId: string, expectedVersion: number, priceCents: number, idempotencyKey: string) => request('mip.admin.membershipPlans.save', { planId, expectedVersion, priceCents, idempotencyKey }),
  }
}
// MIW-104：等级的 levelKey 按 lvNN 约定生成（服务端等级号解析的事实源，见
// mip-growth-api levelDto / 两份 public-person-details）。取现有 lvNN 之外的最小
// 未用号；历史随机 key 不参与，运营仍可在库里改。
function nextLevelKey(existingLevelKeys: readonly string[]): string {
  const used = new Set(existingLevelKeys.map(key => (/^lv0*(\d{1,4})$/i.exec(String(key).trim()) || [])[1]).filter(Boolean).map(Number))
  let candidate = 1
  while (used.has(candidate) && candidate < 9999) candidate += 1
  return `lv${String(candidate).padStart(2, '0')}`
}
export function configurationDraft(kind: ConfigurationKind, item: ConfigurationItem | null, demo = false, existingLevelKeys: readonly string[] = []): Record<string, unknown> {
  if (item) return { ...item, benefitIds: Array.isArray(item.benefits) ? item.benefits.map((benefit: { id: string }) => benefit.id) : [] }
  const key = kind === 'levels' ? nextLevelKey(existingLevelKeys) : crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  return { name: demo ? ({ levels: '演示·探索者', benefits: '演示·社区交流资料', badges: '演示·热心伙伴', rules: '演示奖励' })[kind] : '',
    description: demo ? '用于演示，可由管理员修改或停用，不代表正式服务承诺。' : '',
    status: 'DRAFT', sortOrder: 0, levelKey: key, key, minimumExperience: 0, benefitIds: [], displayBadge: '', iconName: '', imageUrl: '', imageAssetId: '', acquireCondition: '', category: 'IDENTITY', placeholderShape: 'CIRCLE' }
}
