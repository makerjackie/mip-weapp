import type { RuntimeConfig } from '../runtime/config'

export type CloudbaseReadiness = 'disabled' | 'initializing' | 'ready' | 'error'
export type WeappCloudClient = Pick<WxCloud, 'callFunction' | 'downloadFile' | 'getTempFileURL' | 'uploadFile'>

export interface CloudbaseStatus {
  mode: RuntimeConfig['cloudbase']['mode']
  readiness: CloudbaseReadiness
  message: string
}

export interface CloudbaseRuntimeOptions {
  disabledMessage?: string
  initializingMessage?: string
  unavailableMessage?: string
  directReadyMessage?: string
  sharedReadyMessage?: string
  retryDelayMs?: number
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/** Owns one app's CloudBase initialization, cold-handshake retry, and readiness state. */
export function createCloudbaseRuntime(config: RuntimeConfig, options: CloudbaseRuntimeOptions = {}) {
  const messages = {
    disabled: options.disabledMessage || '未配置云环境；本地 UI 仍可使用',
    initializing: options.initializingMessage || '正在连接服务',
    unavailable: options.unavailableMessage || '服务暂时不可用',
    directReady: options.directReadyMessage || 'CloudBase 已连接',
    sharedReady: options.sharedReadyMessage || '共享云环境已连接',
  }
  let initialization: Promise<WeappCloudClient> | undefined
  let initializationError: Error | undefined
  let readiness: CloudbaseReadiness = config.cloudbase.mode === 'disabled' ? 'disabled' : 'initializing'
  let message = config.cloudbase.mode === 'disabled' ? messages.disabled : messages.initializing

  function initialize() {
    if (initialization || config.cloudbase.mode === 'disabled') {
      return
    }
    initializationError = undefined
    readiness = 'initializing'
    message = messages.initializing
    initialization = (async () => {
      if (config.cloudbase.mode === 'shared') {
        const sharedCloud = new wx.cloud.Cloud({
          resourceAppid: config.cloudbase.resourceAppId,
          resourceEnv: config.cloudbase.envId,
        })
        await sharedCloud.init()
        return sharedCloud
      }
      wx.cloud.init({ env: config.cloudbase.envId, traceUser: true })
      return wx.cloud
    })()
    void initialization.then(() => {
      readiness = 'ready'
      message = config.cloudbase.mode === 'shared' ? messages.sharedReady : messages.directReady
    }).catch((error) => {
      // Keep the technical cause in the console while exposing stable product copy.
      // eslint-disable-next-line no-console
      console.error('[cloudbase] initialization failed', error)
      initializationError = new Error(messages.unavailable)
      initialization = undefined
      readiness = 'error'
      message = messages.unavailable
    })
  }

  async function requireClient(): Promise<WeappCloudClient> {
    if (config.cloudbase.mode === 'disabled') {
      throw new Error(messages.disabled)
    }
    initialize()
    try {
      if (!initialization) {
        throw initializationError || new Error(messages.unavailable)
      }
      return await initialization
    }
    catch {
      await delay(options.retryDelayMs ?? 240)
      initialize()
      if (!initialization) {
        throw initializationError || new Error(messages.unavailable)
      }
      return initialization
    }
  }

  function getStatus(): CloudbaseStatus {
    return { mode: config.cloudbase.mode, readiness, message }
  }

  return { getStatus, initialize, requireClient }
}
