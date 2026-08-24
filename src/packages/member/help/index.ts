import { mipOperationsConfig } from '../../../config/mip-operations'

Page({
  data: {
    state: 'ready' as const,
    hasSupportPhone: Boolean(mipOperationsConfig.supportPhone),
    hasVideoChannel: Boolean(mipOperationsConfig.videoChannelFinderUserName),
  },
  callSupport() {
    if (mipOperationsConfig.supportPhone) {
      wx.makePhoneCall({
        phoneNumber: mipOperationsConfig.supportPhone,
        fail: () => wx.showToast({ title: '暂时无法拨打电话', icon: 'none' }),
      })
    }
  },
  openVideoChannel() {
    if (mipOperationsConfig.videoChannelFinderUserName) {
      wx.openChannelsUserProfile({
        finderUserName: mipOperationsConfig.videoChannelFinderUserName,
        fail: () => wx.showToast({ title: '暂时无法打开视频号', icon: 'none' }),
      })
    }
  },
})
