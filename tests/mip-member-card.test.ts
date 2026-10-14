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
    expect(memberPackage.pages).not.toContain('mip-avatar/index')
    expect(memberPackage.pages).not.toContain('mip-services/index')
    expect(profile).toContain('bind:tap="openMemberCard"')
    expect(view).toContain('wx:for="{{themeOptions}}"')
    expect(view).toContain('data-key="{{item.key}}"')
    expect(page).toContain('type CardStyleKey = \'PINK\' | \'BLUE\' | \'WHITE\' | \'YELLOW\'')
    expect(view).toContain('openType="share"')
    expect(page).toContain('wx.saveImageToPhotosAlbum')
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
    // figma 1732_20401 卡面字段 = 姓名/公司/职位/组织/组织职位 + 联系行，无性别行。
    expect(view).not.toContain('{{gender}}')
    expect(page).not.toContain('性别 ·')
    // 样式缩略图与设计稿一致用 IMAGE FILL（aspectFill），避免 1053×738 底图被挤压变形。
    expect(view).toContain('mode="aspectFill"')
    // MIW-100（2026-10-14）：project.config.json 开着 ignoreUploadUnusedFiles，上传依赖
    // 分析探不到 {{}} 动态绑定，纯动态引用的底图会被剔除出体验版（真机显纯色、工具正常）。
    // 四张卡面底图与缩略图必须保持 WXML 静态引用，禁止回退为 src="{{theme.asset}}"。
    for (const asset of [
      'card-bg-a.webp',
      'card-bg-b.webp',
      'card-bg-c.webp',
      'card-bg-d-yellow.webp',
      'card-thumb-yellow.png',
    ]) {
      expect(view).toContain(`src="/packages/member/assets/figma/profile/${asset}"`)
    }
    expect(view).not.toContain('src="{{theme.asset}}"')
    expect(view).not.toContain('src="{{item.thumbAsset}}"')
    expect(view).toContain('下载名片')
    expect(page).toContain('/packages/member/mip-public-profile/index?profileRef=')
    for (const field of ['realName', 'wechat', 'email', 'address']) {
      expect(editorView).toContain(`data-field="${field}"`)
    }
    expect(editorView).toContain('data-kind="companies"')
    expect(editorView).toContain('data-field="name"')
    expect(editorView).toContain('data-field="role"')
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
