export interface WechatChannelsDestination {
  provider: 'WECHAT_CHANNELS'
  type: 'PROFILE' | 'ACTIVITY'
  finderUserName: string
  feedId: string | null
}

export type WechatChannelsOpenResult
  = | { status: 'opened' }
    | { status: 'unsupported' }
    | { status: 'cancelled' }
    | { status: 'failed' }

interface WechatChannelsFailure {
  errMsg?: string
}

interface WechatChannelsOptions {
  finderUserName: string
  feedId?: string
  success: () => void
  fail: (error: WechatChannelsFailure) => void
}

type WechatChannelsApi = (options: WechatChannelsOptions) => unknown

const nativeCallbackTimeoutMs = 10_000

function cancelled(error: WechatChannelsFailure) {
  return typeof error.errMsg === 'string' && error.errMsg.toLowerCase().includes('cancel')
}

function validDestination(destination: WechatChannelsDestination) {
  return destination.provider === 'WECHAT_CHANNELS'
    && /^sph[A-Za-z0-9]+$/.test(destination.finderUserName)
    && destination.finderUserName.length <= 128
    && ((destination.type === 'PROFILE' && destination.feedId === null)
      || (destination.type === 'ACTIVITY'
        && typeof destination.feedId === 'string'
        && destination.feedId.length > 0
        && destination.feedId.length <= 256
        && /^[\w=:+/.-]+$/.test(destination.feedId)))
}

export function openWechatChannelsDestination(
  destination: WechatChannelsDestination,
): Promise<WechatChannelsOpenResult> {
  if (!validDestination(destination)) {
    return Promise.resolve({ status: 'failed' })
  }
  if (typeof wx === 'undefined') {
    return Promise.resolve({ status: 'unsupported' })
  }
  const wechat = wx as unknown as {
    openChannelsUserProfile?: WechatChannelsApi
    openChannelsActivity?: WechatChannelsApi
  }
  const api = destination.type === 'PROFILE'
    ? wechat.openChannelsUserProfile
    : wechat.openChannelsActivity
  if (typeof api !== 'function') {
    return Promise.resolve({ status: 'unsupported' })
  }
  return new Promise((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const finish = (result: WechatChannelsOpenResult) => {
      if (!settled) {
        settled = true
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
        }
        resolve(result)
      }
    }
    timeoutId = setTimeout(finish, nativeCallbackTimeoutMs, { status: 'failed' })
    try {
      api({
        finderUserName: destination.finderUserName,
        ...(destination.type === 'ACTIVITY' ? { feedId: destination.feedId || undefined } : {}),
        success: () => finish({ status: 'opened' }),
        fail: error => finish({ status: cancelled(error) ? 'cancelled' : 'failed' }),
      })
    }
    catch {
      finish({ status: 'failed' })
    }
  })
}
