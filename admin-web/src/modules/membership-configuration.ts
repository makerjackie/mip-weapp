import type { AdminRequest } from './admin-read-contracts'
export type ConfigurationKind = 'levels' | 'benefits' | 'rules' | 'badges'
export interface ConfigurationItem { id: string; name: string; version: number; status: string; [key: string]: unknown }
export interface MembershipAgreement { title: string; body: string; isDemo: boolean; version: number; updatedAt: string | null }
export const demoMembershipAgreement = {
  title: '会员服务协议（演示）', isDemo: true,
  body: '【演示内容，仅供测试，不作为正式会员服务承诺】\n\n一、服务范围\n本演示会员可查看社区活动、交流资料与成长任务。具体服务、资格及有效期以后台配置和页面展示为准。\n\n二、成长与奖励\n完成任务后的经验值、贡献值和勋章，以服务端记录及管理员配置为准。演示奖励不承诺现金收益；奖金如有配置，需由运营另行核验和线下处理。\n\n三、使用规范\n请提供真实资料，尊重其他成员，不发布违法或侵权内容。\n\n四、服务调整与反馈\n此处为可编辑示例。正式上线前请替换为实际服务提供方、服务范围、退款及终止规则、联系方式等内容。',
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
    agreement: () => request<MembershipAgreement>('mip.admin.membershipAgreement.get'),
    saveAgreement: (version: number, draft: Pick<MembershipAgreement, 'title' | 'body' | 'isDemo'>, idempotencyKey: string) => request('mip.admin.membershipAgreement.save', { expectedVersion: version, draft, idempotencyKey }),
  }
}
export function configurationDraft(kind: ConfigurationKind, item: ConfigurationItem | null, demo = false): Record<string, unknown> {
  if (item) return { ...item, benefitIds: Array.isArray(item.benefits) ? item.benefits.map((benefit: { id: string }) => benefit.id) : [] }
  const key = `demo_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
  return { name: demo ? ({ levels: '演示·探索者', benefits: '演示·社区交流资料', badges: '演示·热心伙伴', rules: '演示奖励' })[kind] : '',
    description: demo ? '用于演示，可由管理员修改或停用，不代表正式服务承诺。' : '',
    status: 'DRAFT', sortOrder: 0, levelKey: key, key, minimumExperience: 0, benefitIds: [], displayBadge: '', iconName: '', imageUrl: '', placeholderShape: 'CIRCLE' }
}
