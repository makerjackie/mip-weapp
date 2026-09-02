import type {
  MipProfileSnapshot,
  ProfileUpdateInput,
  ProfileVisibility,
} from '../../../modules/mip-identity'

export interface ProfileVisibilitySelection {
  visibilityNickname: boolean
  visibilityRealName: boolean
  visibilityGender: boolean
  visibilityCareerIdentity: boolean
  visibilityAvatar: boolean
  visibilityIdentityStatus: boolean
  visibilityHeadline: boolean
  visibilityIntroduction: boolean
  visibilityCompanies: boolean
  visibilityOrganizations: boolean
  visibilityIndustry: boolean
  visibilityAbilities: boolean
  visibilityPrimaryBranch: boolean
  visibilityInfluence: boolean
  visibilityPhone: boolean
  visibilityWechat: boolean
  visibilityEmail: boolean
  visibilityAddress: boolean
}

export function visibilitySelection(
  visibility: ProfileVisibility,
): ProfileVisibilitySelection {
  return {
    visibilityNickname: visibility.nickname !== false,
    visibilityRealName: visibility.realName === true,
    visibilityGender: visibility.gender === true,
    visibilityCareerIdentity: visibility.careerIdentity === true,
    visibilityAvatar: visibility.avatar !== false,
    visibilityIdentityStatus: visibility.identityStatus !== false,
    visibilityHeadline: visibility.headline !== false,
    visibilityIntroduction: visibility.introduction !== false,
    visibilityCompanies: visibility.companies !== false,
    visibilityOrganizations: visibility.organizations !== false,
    visibilityIndustry: visibility.industry !== false,
    visibilityAbilities: visibility.abilities !== false,
    visibilityPrimaryBranch: visibility.primaryBranch !== false,
    visibilityInfluence: visibility.influence === true,
    visibilityPhone: visibility.cardContacts?.phone === true,
    visibilityWechat: visibility.cardContacts?.wechat === true,
    visibilityEmail: visibility.cardContacts?.email === true,
    visibilityAddress: visibility.cardContacts?.address === true,
  }
}

export function profileVisibilityUpdate(
  profile: MipProfileSnapshot,
  selection: ProfileVisibilitySelection,
): ProfileUpdateInput {
  return {
    expectedVersion: profile.version,
    nickname: profile.nickname,
    realName: profile.realName,
    gender: profile.gender,
    careerIdentityKey: profile.careerIdentityKey,
    identityStatus: profile.identityStatus,
    headline: profile.headline,
    introduction: profile.introduction,
    companies: profile.companies,
    organizations: profile.organizations,
    visibility: {
      nickname: selection.visibilityNickname,
      realName: selection.visibilityRealName,
      gender: selection.visibilityGender,
      careerIdentity: selection.visibilityCareerIdentity,
      avatar: selection.visibilityAvatar,
      identityStatus: selection.visibilityIdentityStatus,
      headline: selection.visibilityHeadline,
      introduction: selection.visibilityIntroduction,
      companies: selection.visibilityCompanies,
      organizations: selection.visibilityOrganizations,
      industry: selection.visibilityIndustry,
      abilities: selection.visibilityAbilities,
      primaryBranch: selection.visibilityPrimaryBranch,
      influence: selection.visibilityInfluence,
      cardContacts: {
        phone: selection.visibilityPhone,
        wechat: selection.visibilityWechat,
        email: selection.visibilityEmail,
        address: selection.visibilityAddress,
      },
    },
    primaryIndustryTagId: profile.primaryIndustryTagId,
    abilityTagIds: [...profile.abilityTagIds],
  }
}
