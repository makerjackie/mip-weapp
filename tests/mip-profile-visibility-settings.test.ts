import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  profileVisibilityUpdate,
  visibilitySelection,
} from '../src/packages/member/mip-visibility-settings/visibility-save-intent'

const root = path.resolve(import.meta.dirname, '..')

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

describe('MIP profile visibility settings', () => {
  it('preserves profile fields while replacing the complete visibility contract', () => {
    const profile = {
      exists: true,
      version: 7,
      nickname: '小明',
      realName: '张明',
      gender: 'MALE' as const,
      careerIdentityKey: 'FOUNDER',
      avatarBound: true,
      avatarAssetId: 'asset-1',
      avatarUrl: 'https://example.com/avatar.png',
      identityStatus: '创业者',
      headline: '产品负责人',
      introduction: '个人介绍',
      companies: [{ name: '示例公司', role: '负责人' }],
      organizations: [{ name: '示例组织', role: '成员' }],
      visibility: {
        headline: true,
        introduction: true,
        companies: true,
        organizations: true,
      },
      primaryIndustryTagId: 'industry-1',
      abilityTagIds: ['ability-1'],
      privateContact: { phoneBound: true },
      complete: true,
      missingFields: [],
    }
    const selection = {
      ...visibilitySelection(profile.visibility),
      visibilityNickname: false,
      visibilityCompanies: false,
      visibilityPhone: true,
      visibilityEmail: true,
    }

    expect(profileVisibilityUpdate(profile, selection)).toEqual({
      expectedVersion: 7,
      nickname: '小明',
      realName: '张明',
      gender: 'MALE',
      careerIdentityKey: 'FOUNDER',
      identityStatus: '创业者',
      headline: '产品负责人',
      introduction: '个人介绍',
      companies: [{ name: '示例公司', role: '负责人' }],
      organizations: [{ name: '示例组织', role: '成员' }],
      visibility: {
        nickname: false,
        realName: false,
        gender: false,
        careerIdentity: false,
        avatar: true,
        identityStatus: true,
        headline: true,
        introduction: true,
        companies: false,
        organizations: true,
        industry: true,
        abilities: true,
        primaryBranch: true,
        influence: false,
        cardContacts: { phone: true, wechat: false, email: true, address: false },
      },
      primaryIndustryTagId: 'industry-1',
      abilityTagIds: ['ability-1'],
    })
  })

  it('registers the page in every route contract', () => {
    const route = 'mip-visibility-settings/index'
    const app = JSON.parse(source('src/app.json'))
    const project = JSON.parse(source('config/project.json'))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    const memberPackage = app.subPackages.find((item: { root: string }) => item.root === 'packages/member')

    expect(memberPackage.pages).toContain(route)
    expect(project.routes).toContainEqual({
      name: '公开设置',
      pathName: `packages/member/${route}`,
    })
    expect(runtime.routes).toContainEqual(expect.objectContaining({
      id: 'M49',
      path: `packages/member/${route}`,
      selector: '#mip-visibility-settings-page',
    }))
  })

  it('separates profile and card visibility from data entry forms', () => {
    const page = source('src/packages/member/mip-visibility-settings/index.ts')
    const view = source('src/packages/member/mip-visibility-settings/index.wxml')
    const privacy = source('src/packages/member/privacy/index.ts')
    const profileView = source('src/packages/member/mip-profile/index.wxml')
    const cardView = source('src/packages/member/mip-card-edit/index.wxml')

    expect(view).toContain('data-visibility-group="profile"')
    expect(view).toContain('data-visibility-group="card-contacts"')
    expect(view).not.toMatch(/<(input|textarea)\b/)
    expect(page).toContain('mipIdentityModule.saveProfile(profileVisibilityUpdate(profile, this.data))')
    expect(privacy).toContain('/packages/member/mip-visibility-settings/index')
    expect(profileView).not.toContain('updateVisibility')
    expect(cardView).not.toContain('updateVisibility')
  })
})
