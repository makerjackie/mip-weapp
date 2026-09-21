/**
 * journey-review J5-03 隐私设置（figma 1861_18278）：
 * 「不让他人在搜索人才时找到我」「不让非MIP玩家看到我发布的机会」两行开关。
 *
 * 服务端目前没有这两个偏好字段（身份域合同缺口已登记 shared-change-requests，
 * 落库需追加迁移），一期按规格 §8 允许先走本机存储持久化 + TODO；
 * 开关只表达用户意图，人才搜索 / 机会列表的实际可见性仍由服务端决定。
 */
const PRIVACY_SETTINGS_STORAGE_KEY = 'mip.settings.privacy.v1'

interface PrivacySettings {
  hideFromTalentSearch: boolean
  hideOpportunitiesFromNonPlayers: boolean
}

/** 帧内两开关均绘为开：默认开（默认值待产品确认）。 */
const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  hideFromTalentSearch: true,
  hideOpportunitiesFromNonPlayers: true,
}

type PrivacySettingsKey = keyof PrivacySettings

const privacySettingKeys = new Set<PrivacySettingsKey>([
  'hideFromTalentSearch',
  'hideOpportunitiesFromNonPlayers',
])

function readPrivacySettings(): PrivacySettings {
  try {
    const stored = wx.getStorageSync(PRIVACY_SETTINGS_STORAGE_KEY) as Partial<PrivacySettings> | undefined
    if (!stored) {
      return { ...DEFAULT_PRIVACY_SETTINGS }
    }
    return {
      hideFromTalentSearch: typeof stored.hideFromTalentSearch === 'boolean'
        ? stored.hideFromTalentSearch
        : DEFAULT_PRIVACY_SETTINGS.hideFromTalentSearch,
      hideOpportunitiesFromNonPlayers: typeof stored.hideOpportunitiesFromNonPlayers === 'boolean'
        ? stored.hideOpportunitiesFromNonPlayers
        : DEFAULT_PRIVACY_SETTINGS.hideOpportunitiesFromNonPlayers,
    }
  }
  catch {
    return { ...DEFAULT_PRIVACY_SETTINGS }
  }
}

Page({
  data: {
    state: 'ready' as const,
    ...readPrivacySettings(),
  },

  onToggle(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const key = String(event.currentTarget.dataset.key || '') as PrivacySettingsKey
    if (!privacySettingKeys.has(key)) {
      return
    }
    const next = Boolean(event.detail.value)
    const previous = this.data[key]
    if (next === previous) {
      return
    }
    // 即时保存：失败回滚开关并提示，避免界面与持久化状态不一致。
    this.setData({ [key]: next })
    try {
      wx.setStorageSync(PRIVACY_SETTINGS_STORAGE_KEY, {
        ...readPrivacySettings(),
        [key]: next,
      })
    }
    catch {
      this.setData({ [key]: previous })
      wx.showToast({ title: '设置暂未保存，请重试。', icon: 'none' })
    }
  },
})
