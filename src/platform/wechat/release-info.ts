/** Deployment environment comes from the baked function target, not WeChat's release channel. */
export function readMiniProgramReleaseInfo(fallbackVersion: string, testEnvironment: boolean) {
  let version = fallbackVersion
  let channelLabel = '开发版'
  try {
    const miniProgram = wx.getAccountInfoSync().miniProgram
    if (miniProgram.version?.trim()) {
      version = miniProgram.version.trim()
    }
    channelLabel = miniProgram.envVersion === 'release'
      ? '正式版'
      : miniProgram.envVersion === 'trial' ? '体验版' : '开发版'
  }
  catch {
    // DevTools and older hosts can omit account information; the release build bakes its upload version.
  }
  return {
    version,
    environmentText: `${testEnvironment ? '测试环境' : '生产环境'} · ${channelLabel}`,
  }
}
