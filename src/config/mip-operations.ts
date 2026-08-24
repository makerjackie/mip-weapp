export const mipOperationsConfig = {
  replaceBeforeProduction: true,
  supportPhone: '13798316515',
  videoChannelFinderUserName: '',
  eventBanners: [
    {
      id: 'mip-events-overview',
      imagePath: '/assets/figma/events/banner.png',
      accessibilityLabel: 'MIP 活动',
      targetType: 'PAGE',
      target: '/pages/events/index',
    },
    {
      id: 'mip-events-article-placeholder',
      imagePath: '/assets/figma/events/event-cover-2.png',
      accessibilityLabel: 'MIP 活动说明',
      targetType: 'ARTICLE',
      target: 'https://mp.weixin.qq.com/s/replace-before-production',
    },
  ],
  homeBanner: {
    imagePath: '',
    targetPath: '',
    accessibilityLabel: '运营活动',
  },
  defaultCoverPaths: {
    event: '/assets/figma/events/event-cover-1.png',
    opportunity: '/assets/figma/opportunities/opportunity-cover-1.png',
    superCase: '/assets/brand/mip-logo-yellow.png',
  },
} as const
