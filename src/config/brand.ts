export const brand = {
  productName: '同行会',
  tagline: '一起认识 · 一起发生',
  logoPath: '/assets/brand/tongxinghui-logo.webp',
  markText: '会',
  operatorName: '同行会运营团队',
  supportChannel: '小程序客服',
  contactHint: '请通过小程序客服联系运营团队',
  privacyPolicyPath: '/packages/member/privacy/index',
  userAgreementPath: '/packages/member/about/index',
  colors: {
    canvas: '#F6F4EE',
    panel: '#FFFEFA',
    ink: '#1D2A23',
    muted: '#69726B',
    line: '#DDD9CF',
    brand: '#285E46',
    onBrand: '#FFFFFF',
    brandActive: '#1E4936',
    brandSoft: '#E2EEE7',
    accent: '#E77745',
    danger: '#B8453E',
    success: '#2F7758',
  },
} as const

export type BrandConfig = typeof brand
