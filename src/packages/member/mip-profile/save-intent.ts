interface ProfileSaveReadiness {
  nickname: string
}

export function profileSaveValidationMessage(input: ProfileSaveReadiness) {
  if (!input.nickname.trim()) {
    return '请填写昵称。'
  }
  return ''
}
