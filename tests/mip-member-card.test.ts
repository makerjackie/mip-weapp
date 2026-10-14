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
    // 样式缩略图与设计稿一致用 IMAGE FILL（aspectFill），避免底图被挤压变形。
    expect(view).toContain('mode="aspectFill"')
    // 卡面/缩略均绑定 CDN PNG（src/config/card-art.ts）：包内烘焙图连 wx:elif 静态分支引用
    // 也被 ignoreUploadUnusedFiles 上传依赖分析剔除（MIW-100 静态分支方案 2026-10-14 真机
    // 复验失败，四个款式全部只剩纯色垫底），网络图不经过包分析与设备 webp 解码器。
    expect(view).toContain('src="{{theme.asset}}"')
    expect(view).toContain('src="{{item.thumb}}"')
    expect(view).not.toContain('/packages/member/assets/figma/profile/card-')
    expect(editorView).toContain('src="{{previewCardBgUrl}}"')
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

  it('keeps member card art on the CDN as PNG and out of the package', () => {
    // 真机 image 解码器不支持 VP8L/ALPH webp，包内图经上传依赖分析后真机也不可达
    // （见上一用例注释）；卡面素材必须以 PNG 放 assets/cdn（不进 src/，否则会进分包），
    // 由 pnpm cloud:cdn-assets:deploy 上传 mip-admin-console/mip-weapp-assets/ 前缀，
    // 经 admin 网关域访问（默认托管域 tcloudbaseapp.com 对部分出口区域回 418）。
    const cardArt = source('src/config/card-art.ts')
    expect(cardArt).toContain('mip-weapp-assets/member-card/')
    expect(cardArt).toContain('brand.adminConsoleDomain')
    for (const asset of ['card-bg-a.png', 'card-bg-b.png', 'card-bg-c.png', 'card-bg-d-yellow.png', 'card-thumb-yellow.png']) {
      const bytes = fs.readFileSync(path.join(root, 'assets/cdn/member-card/v1', asset))
      expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    }
    // 素材源文件不得回流 src/（会被打进分包且真机不可渲染）。
    const profileAssets = fs.readdirSync(path.join(root, 'src/packages/member/assets/figma/profile'))
    expect(profileAssets.filter(file => /^card-(?:bg|thumb)/.test(file))).toEqual([])
  })
})
