import { brand } from '../../../config/brand'
import { isTestEnvironment, runtimeConfig } from '../../../config/runtime'
import { readMiniProgramReleaseInfo } from '../../../platform/wechat/release-info'

const release = readMiniProgramReleaseInfo(runtimeConfig.appVersion, isTestEnvironment())

Page({
  data: {
    state: 'ready' as const,
    productName: brand.productName,
    markText: brand.markText,
    versionText: `${brand.productName} v${release.version}`,
    environmentText: release.environmentText,
    operatorName: brand.operatorName,
    websiteDomain: brand.websiteDomain,
    icpFilingNumber: brand.icpFilingNumber,
  },

  copyVersion() {
    wx.setClipboardData({ data: `${this.data.versionText} · ${this.data.environmentText}` })
  },
})
