import type { BranchId } from '../../../modules/mip'
import type { ProfileUpdateInput } from '../../../modules/mip-identity'

interface ProfileSaveReadiness {
  nickname: string
  branchId: string
  currentBranchId: string
  requirePrimaryBranch: boolean
}

type ProfileBranchUpdate = Pick<ProfileUpdateInput, 'expectedUserVersion' | 'primaryBranchId'>

export function profileSaveValidationMessage(input: ProfileSaveReadiness) {
  if (!input.nickname.trim()) {
    return '请填写昵称。'
  }
  if (input.currentBranchId.trim() && !input.branchId.trim()) {
    return '主城市分会不可清空，请重新选择。'
  }
  if (input.requirePrimaryBranch && !input.branchId.trim()) {
    return '请选择主城市分会。'
  }
  return ''
}

export function profileBranchUpdate(branchId: string, userVersion: number): ProfileBranchUpdate {
  const normalizedBranchId = branchId.trim()
  if (!normalizedBranchId) {
    return {}
  }
  return {
    expectedUserVersion: userVersion,
    primaryBranchId: normalizedBranchId as BranchId,
  }
}
