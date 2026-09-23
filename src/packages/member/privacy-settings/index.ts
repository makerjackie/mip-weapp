import type { IdentityAccessSnapshot } from '../../../modules/mip-identity'
import { mipIdentityModule } from '../../../modules/mip-identity/client'

type PrivacyKey = 'hideFromTalentSearch' | 'hideOpportunitiesFromNonPlayers'
const privacyKeys = new Set<PrivacyKey>(['hideFromTalentSearch', 'hideOpportunitiesFromNonPlayers'])

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    saving: false,
    message: '',
    hideFromTalentSearch: false,
    hideOpportunitiesFromNonPlayers: false,
  },
  snapshot: null as IdentityAccessSnapshot | null,
  onLoad() { void this.load() },
  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (!snapshot.authenticated || !snapshot.profile.exists) {
        throw new Error('请先登录并完善资料。')
      }
      this.applySnapshot(snapshot)
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '隐私设置暂时无法加载。' })
    }
  },
  applySnapshot(snapshot: IdentityAccessSnapshot) {
    this.snapshot = snapshot
    this.setData({
      state: 'ready',
      hideFromTalentSearch: snapshot.profile.visibility.talentSearch === false,
      hideOpportunitiesFromNonPlayers: snapshot.profile.visibility.opportunitiesForNonPlayers === false,
    })
  },
  async onToggle(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const key = String(event.currentTarget.dataset.key || '') as PrivacyKey
    if (!privacyKeys.has(key) || !this.snapshot || this.data.state !== 'ready' || this.data.saving) {
      return
    }
    const next = Boolean(event.detail.value)
    const previous = this.data[key]
    if (next === previous) {
      return
    }
    const profile = this.snapshot.profile
    const field = key === 'hideFromTalentSearch' ? 'talentSearch' : 'opportunitiesForNonPlayers'
    this.setData({ [key]: next, saving: true, message: '' })
    try {
      const snapshot = await mipIdentityModule.saveProfile({
        expectedVersion: profile.version,
        avatarAssetId: profile.avatarAssetId,
        nickname: profile.nickname,
        realName: profile.realName,
        gender: profile.gender,
        careerIdentityKey: profile.careerIdentityKey,
        identityStatus: profile.identityStatus,
        headline: profile.headline,
        introduction: profile.introduction,
        companies: profile.companies,
        organizations: profile.organizations,
        primaryIndustryTagId: profile.primaryIndustryTagId,
        abilityTagIds: profile.abilityTagIds,
        visibility: { ...profile.visibility, [field]: !next },
      })
      this.applySnapshot(snapshot)
    }
    catch (error) {
      this.setData({ [key]: previous, message: error instanceof Error ? error.message : '设置暂未保存，请重试。' })
      // A conflicting edit refreshes the entire versioned profile before another attempt.
      try {
        this.applySnapshot(await mipIdentityModule.loadSnapshot())
      }
      catch { this.setData({ state: 'error' }) }
    }
    finally { this.setData({ saving: false }) }
  },
})
