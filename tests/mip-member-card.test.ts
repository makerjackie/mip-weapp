import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

describe('MIP member card', () => {
  it('is reachable from profile and offers selectable styles, sharing, and album export', () => {
    const app = JSON.parse(source('src/app.json'))
    const memberPackage = app.subPackages.find((item: { root: string }) => item.root === 'packages/member')
    const profile = source('src/pages/profile/index.wxml')
    const page = source('src/packages/member/mip-card/index.ts')
    const view = source('src/packages/member/mip-card/index.wxml')
    const editor = source('src/packages/member/mip-card-edit/index.ts')
    const editorView = source('src/packages/member/mip-card-edit/index.wxml')

    expect(memberPackage.pages).toContain('mip-card/index')
    expect(memberPackage.pages).toContain('mip-card-edit/index')
    expect(memberPackage.pages).toContain('mip-avatar/index')
    expect(profile).toContain('bind:tap="openMemberCard"')
    expect(profile).toContain('bind:tap="openDigitalAvatar"')
    expect(view).toContain('wx:for="{{themeOptions}}"')
    expect(view).toContain('data-key="{{item.key}}"')
    expect(page).toContain('type CardStyleKey = \'PINK\' | \'BLUE\' | \'WHITE\' | \'YELLOW\'')
    expect(view).toContain('open-type="share"')
    expect(page).toContain('wx.saveImageToPhotosAlbum')
    expect(page).toContain('mipAiModule.listDigitalAvatars')
    expect(view).toContain('data-source="DIGITAL"')
    expect(page).toContain('mipIdentityModule.getMyProfileCardCode')
    expect(view).toContain('codeUrl')
    expect(view).toContain('{{companyName}}')
    expect(view).toContain('{{roleTitle}}')
    expect(page).not.toContain('GENERIC_MINI_PROGRAM_CODE')
    expect(page).toContain('codeMessage: codeUrl ? \'\' : \'名片码暂时不可用，可稍后重试。\'')
    expect(page).toContain('this.setData({ codeUrl: result.codeUrl, codeMessage: \'\', posterPath: \'\' })')
    expect(view).toContain('{{phone}}')
    expect(view).toContain('{{wechat}}')
    expect(view).toContain('{{email}}')
    expect(view).toContain('{{address}}')
    expect(view).toContain('{{gender}}')
    expect(page).toContain('gender: profile.gender === \'MALE\' ? \'男\' : profile.gender === \'FEMALE\' ? \'女\' : \'\'')
    expect(page).toContain(`\`性别  \${this.data.gender}\``)
    expect(view).toContain('下载名片')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
    for (const field of ['realName', 'company', 'role', 'wechat', 'email', 'address']) {
      expect(editorView).toContain(`data-field="${field}"`)
    }
    expect(editorView).toContain('open-type="getPhoneNumber"')
    expect(editor).toContain('phoneBinding')
    expect(editor).toContain('mipIdentityModule.updateCard')
  })

  it('uses a server-created opaque self profile reference instead of exposing a raw user id', () => {
    const service = source('cloudfunctions/mip-identity-api/domain/service.js')
    const entry = source('cloudfunctions/mip-identity-api/index.js')

    expect(service).toContain('profileRefWriter')
    expect(service).toContain('profileRefWriter({ appId: caller.appId, userId: user.id })')
    expect(entry).toContain('createProfileRef(input, process.env.MIP_IDENTITY_PEPPER)')
    expect(entry).toContain('createProfileCardCode')
    expect(entry).toContain('readProfileCardScene')
  })
})
