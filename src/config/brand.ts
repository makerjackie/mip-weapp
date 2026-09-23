export const brand = {
  productName: 'MIP',
  tagline: '会员、活动与合作',
  logoPath: '/assets/brand/mip-logo-yellow.png',
  opportunityDefaultCoverPath: '/assets/brand/mip-opportunity-default.jpg',
  markText: 'MIP',
  operatorName: '深圳市奇点聚合科技有限公司',
  websiteDomain: 'mip.cool',
  icpFilingNumber: '粤ICP备2026005262号-2',
  supportChannel: '小程序客服',
  contactHint: '请通过小程序客服联系运营团队',
  privacyPolicyPath: '/packages/member/privacy-policy/index',
  userAgreementPath: '/packages/member/user-agreement/index',
  // MIP design system tokens — see .claude/skills/mip-design-system/references/DESIGN.md §2.
  colors: {
    canvas: '#080808',
    panel: '#202020',
    panelRaised: '#242424',
    ink: '#FFFFFF',
    muted: '#B3B3B3',
    line: '#333333',
    brand: '#FCDF03',
    onBrand: '#080808',
    brandActive: '#D0B801',
    brandSoft: '#4D4400',
    accent: '#FCDF03',
    danger: '#FF4D5E',
    success: '#18E779',
  },
} as const

export type BrandConfig = typeof brand
