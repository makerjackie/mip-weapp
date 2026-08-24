import { MipBannerError } from './types'

export function resolveBannerTransportFunction(
  requestedFunctionName: string,
  bannerFunctionName: string,
  mediaFunctionName: string,
) {
  if (requestedFunctionName === 'mip-banners-api') {
    return bannerFunctionName
  }
  if (requestedFunctionName === 'mip-media-api') {
    return mediaFunctionName
  }
  throw new MipBannerError('SERVICE_UNAVAILABLE', 'Banner 服务请求无效')
}
