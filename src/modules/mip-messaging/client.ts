import { runtimeConfig } from '../../config/runtime'
import { cloudbaseMipMessagingGateway } from './cloudbase-gateway'
import { createMipMessagingModule } from './module'
import { createPopupMessagePresenter } from './popup'
import { createWechatSubscriptionRequester } from './wechat-subscription'

export const mipMessagingModule = createMipMessagingModule(
  cloudbaseMipMessagingGateway,
  createWechatSubscriptionRequester(runtimeConfig.subscribeTemplatesJson),
)

export const mipPopupMessagePresenter = createPopupMessagePresenter(
  mipMessagingModule,
  {
    read: () => wx.getStorageSync('mip:popup-message-presented:v1') as unknown,
    write: value => wx.setStorageSync('mip:popup-message-presented:v1', value),
  },
  {
    showModal: wx.showModal,
    navigateTo: url => wx.navigateTo({ url }),
  },
)
