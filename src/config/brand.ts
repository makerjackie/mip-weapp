export const brand = {
  productName: 'MIP',
  tagline: '会员、活动与合作',
  logoPath: '/assets/brand/mip-logo-yellow.png',
  markText: 'MIP',
  operatorName: 'MIP 运营团队',
  supportChannel: '小程序客服',
  contactHint: '请通过小程序客服联系运营团队',
  privacyPolicyPath: '/packages/member/privacy/index',
  userAgreementPath: '/packages/member/about/index',
  colors: {
    canvas: '#040404',
    panel: '#202020',
    panelRaised: '#2A2A2A',
    ink: '#FFFFFF',
    muted: '#A3A3A3',
    line: '#363636',
    brand: '#FCDF03',
    onBrand: '#040000',
    brandActive: '#E3C900',
    brandSoft: '#3B3505',
    accent: '#FCDF03',
    danger: '#E65C5C',
    success: '#43B581',
  },
} as const

export type BrandConfig = typeof brand
