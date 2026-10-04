import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { profileSaveValidationMessage } from '../src/packages/member/mip-profile/save-intent'

const root = path.resolve(import.meta.dirname, '..')

describe('MIP profile save intent', () => {
  it('only requires a nickname to save the profile', () => {
    expect(profileSaveValidationMessage({ nickname: '新昵称' })).toBe('')
    expect(profileSaveValidationMessage({ nickname: '   ' })).toBe('请填写昵称。')
  })

  it('round-trips full-replace fields the page no longer edits and never submits a branch', () => {
    const page = fs.readFileSync(path.join(root, 'src/packages/member/mip-profile/index.ts'), 'utf8')
    const view = fs.readFileSync(path.join(root, 'src/packages/member/mip-profile/index.wxml'), 'utf8')

    // 保存接口按整行覆盖存储：页面不再编辑的字段必须加载后原值回传，否则每次保存会清空存量。
    expect(page).toContain('realName: snapshot.profile.realName')
    expect(page).toContain('identityStatus: snapshot.profile.identityStatus')
    expect(page).toContain('introduction: snapshot.profile.introduction')
    expect(page).toContain('abilityTagIds: snapshot.profile.abilityTagIds')
    expect(page).toContain('realName: this.data.realName')
    expect(page).toContain('identityStatus: this.data.identityStatus')
    expect(page).toContain('introduction: this.data.introduction')
    expect(page).toContain('abilityTagIds: this.data.abilityTagIds')
    // 主城市分会由管理后台在开通会员时配置，页面不读取也不提交分会字段。
    expect(page).not.toContain('primaryBranchId')
    expect(page).not.toContain('mipBranchesModule')
    expect(page).not.toContain('profileBranchUpdate')
    expect(view).not.toContain('更多资料')
    expect(view).toContain('bindblur="updateText"')
    expect(view).toContain('data-profile-message="true"')
    expect(view).toContain('avatarPending ? \'保存后生效\'')
  })
})
