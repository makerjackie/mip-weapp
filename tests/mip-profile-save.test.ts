import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  profileBranchUpdate,
  profileSaveValidationMessage,
} from '../src/packages/member/mip-profile/save-intent'

const root = path.resolve(import.meta.dirname, '..')

describe('MIP profile save intent', () => {
  it('allows an ordinary profile edit to persist without completing the primary branch', () => {
    expect(profileSaveValidationMessage({
      nickname: '新昵称',
      branchId: '',
      currentBranchId: '',
      requirePrimaryBranch: false,
    })).toBe('')
    expect(profileBranchUpdate('', 7)).toEqual({})
  })

  it('still requires the primary branch while completing a protected access flow', () => {
    expect(profileSaveValidationMessage({
      nickname: '新昵称',
      branchId: '',
      currentBranchId: '',
      requirePrimaryBranch: true,
    })).toBe('请选择主城市分会。')
    expect(profileBranchUpdate('20000000-0000-4000-8000-000000000001', 7)).toEqual({
      expectedUserVersion: 7,
      primaryBranchId: '20000000-0000-4000-8000-000000000001',
    })
  })

  it('does not claim to clear an existing primary branch when the contract only supports updates', () => {
    expect(profileSaveValidationMessage({
      nickname: '新昵称',
      branchId: '',
      currentBranchId: '20000000-0000-4000-8000-000000000001',
      requirePrimaryBranch: false,
    })).toBe('主城市分会不可清空，请重新选择。')
  })

  it('wires nickname blur fallback, visible feedback, and confirmed avatar state into the page', () => {
    const page = fs.readFileSync(path.join(root, 'src/packages/member/mip-profile/index.ts'), 'utf8')
    const view = fs.readFileSync(path.join(root, 'src/packages/member/mip-profile/index.wxml'), 'utf8')

    expect(page).toContain('requirePrimaryBranch: Boolean(this.data.token)')
    expect(page).toContain('...profileBranchUpdate(branchId, this.data.userVersion)')
    expect(page).toContain('avatarAssetId: snapshot.profile.avatarAssetId')
    expect(page).not.toContain('if (!selectedBranch?.id)')
    expect(view).toContain('bindblur="updateText"')
    expect(view).toContain('data-profile-message="true"')
    expect(view).toContain('avatarPending ? \'保存后生效\'')
  })
})
