import { mipOperationsConfig } from '../../../config/mip-operations'

Page({
  data: {
    state: 'ready' as const,
    hasSupportPhone: Boolean(mipOperationsConfig.supportPhone),
    hasVideoChannel: Boolean(mipOperationsConfig.videoChannelFinderUserName),
  },
  callSupport() {
    if (mipOperationsConfig.supportPhone) {
      wx.makePhoneCall({ phoneNumber: mipOperationsConfig.supportPhone })
    }
  },
  openVideoChannel() {
    if (mipOperationsConfig.videoChannelFinderUserName) {
      wx.openChannelsUserProfile({ finderUserName: mipOperationsConfig.videoChannelFinderUserName })
    }
  },
})
