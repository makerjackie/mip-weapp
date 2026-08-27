import { brand } from '../../../config/brand'
import { runtimeConfig } from '../../../config/runtime'

Page({
  data: {
    state: 'ready' as const,
    productName: brand.productName,
    markText: brand.markText,
    versionText: `${brand.productName} v${runtimeConfig.appVersion}`,
    operatorName: brand.operatorName,
    websiteDomain: brand.websiteDomain,
    icpFilingNumber: brand.icpFilingNumber,
  },

  copyVersion() {
    wx.setClipboardData({ data: this.data.versionText })
  },
})
