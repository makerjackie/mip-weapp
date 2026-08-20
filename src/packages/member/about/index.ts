import { brand } from '../../../config/brand'
import { runtimeConfig } from '../../../config/runtime'

Page({
  data: {
    state: 'ready' as const,
    productName: brand.productName,
    tagline: brand.tagline,
    markText: brand.markText,
    versionText: `${brand.productName} v${runtimeConfig.appVersion}`,
  },

  copyVersion() {
    wx.setClipboardData({ data: this.data.versionText })
  },
})
