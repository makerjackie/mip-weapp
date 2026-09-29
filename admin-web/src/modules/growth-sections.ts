export const growthSections = [
  { value: 'levels', label: '等级', capability: 'growth.read' }, { value: 'benefits', label: '等级权益', capability: 'growth.read' },
  { value: 'rules', label: '成长规则', capability: 'growth.read' }, { value: 'entries', label: '成长流水', capability: 'growth.read', paginated: true },
  { value: 'transitions', label: '等级变更', capability: 'growth.read', paginated: true },
  { value: 'badges', label: '勋章目录', capability: 'badges.manage' }, { value: 'awards', label: '勋章获得记录', capability: 'badges.manage', paginated: true },
  { value: 'entitlements', label: '权益流水', capability: 'memberships.read', paginated: true },
  { value: 'contributionRules', label: '贡献值规则', capability: 'growth.read', paginated: true },
  { value: 'contributionTransactions', label: '贡献值流水', capability: 'growth.read', paginated: true },
] as const
