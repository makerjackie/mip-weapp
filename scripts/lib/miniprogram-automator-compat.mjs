import { MiniProgram } from '@weapp-vite/miniprogram-automator'

let installed = false

export function isToolInfoWithoutSdkVersion(toolInfo, error) {
  return toolInfo
    && typeof toolInfo === 'object'
    && typeof toolInfo.version === 'string'
    && /^\d+\.\d+/.test(toolInfo.version)
    && toolInfo.SDKVersion === undefined
    && /reading ['"]split['"]|SDKVersion/i.test(String(error?.message || error))
}

/**
 * DevTools 2.01.2510290 returns only its IDE `version` from Tool.getInfo.
 * @weapp-vite/miniprogram-automator 1.2.8 assumes SDKVersion always exists and
 * otherwise crashes before App readiness can be tested. Limit the compatibility
 * shim to that exact response shape; all other version failures still fail.
 */
export function installMiniprogramAutomatorCompatibility() {
  if (installed) {
    return
  }
  installed = true
  const originalCheckVersion = MiniProgram.prototype.checkVersion
  MiniProgram.prototype.checkVersion = async function checkVersionWithDevtoolsFallback() {
    try {
      return await originalCheckVersion.call(this)
    }
    catch (error) {
      const toolInfo = await this.send('Tool.getInfo')
      if (!isToolInfoWithoutSdkVersion(toolInfo, error)) {
        throw error
      }
      this.connection?.configureToolInfo?.(toolInfo)
    }
  }
}
