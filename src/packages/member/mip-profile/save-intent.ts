interface ProfileSaveReadiness {
  nickname: string
  avatarAssetId: string
  primaryIndustryTagId: string
  careerIdentityKey: string
  headline: string
}

export function profileSaveValidationMessage(input: ProfileSaveReadiness) {
  if (!input.nickname.trim()) {
    return '请填写昵称。'
  }
  if (!input.avatarAssetId.trim()) {
    return '请选择并上传头像。'
  }
  if (!input.primaryIndustryTagId.trim()) {
    return '请选择代表行业。'
  }
  if (!input.careerIdentityKey.trim()) {
    return '请选择当前身份状态。'
  }
  if (!input.headline.trim()) {
    return '请填写一句话介绍你的工作和背景。'
  }
  return ''
}
