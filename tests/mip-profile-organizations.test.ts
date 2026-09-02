import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appendEditableOrganization,
  createEditableOrganizations,
  MAX_PROFILE_ORGANIZATIONS,
  moveEditableOrganization,
  normalizeEditableOrganizations,
  removeEditableOrganization,
  updateEditableOrganization,
  validateEditableOrganizations,
} from '../src/modules/mip-identity/organization-editor'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function organizations(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `公司 ${index + 1}`,
    role: `职位 ${index + 1}`,
  }))
}

describe('MIP profile multiple organizations editor', () => {
  it('restores every company and organization in source order', () => {
    const editable = createEditableOrganizations(
      organizations(MAX_PROFILE_ORGANIZATIONS),
      index => `company-${index}`,
    )

    expect(editable).toHaveLength(12)
    expect(editable[0]).toEqual({ id: 'company-0', name: '公司 1', role: '职位 1' })
    expect(editable[11]).toEqual({ id: 'company-11', name: '公司 12', role: '职位 12' })
  })

  it('adds, edits, reorders and removes entries without changing other values', () => {
    const initial = createEditableOrganizations(organizations(2), index => `company-${index}`)
    const added = appendEditableOrganization(initial, 'company-2')
    const edited = updateEditableOrganization(added, 2, 'name', '公司 3')
    const reordered = moveEditableOrganization(edited, 2, -1)
    const removed = removeEditableOrganization(reordered, 0)

    expect(initial.map(item => item.name)).toEqual(['公司 1', '公司 2'])
    expect(reordered.map(item => item.name)).toEqual(['公司 1', '公司 3', '公司 2'])
    expect(removed.map(item => item.name)).toEqual(['公司 3', '公司 2'])
  })

  it('accepts zero to twelve complete entries and rejects invalid rows', () => {
    expect(validateEditableOrganizations([], '公司')).toBeNull()
    const twelve = createEditableOrganizations(organizations(12), index => `company-${index}`)
    expect(validateEditableOrganizations(twelve, '公司')).toBeNull()
    expect(appendEditableOrganization(twelve, 'company-12')).toBe(twelve)

    const thirteen = [...twelve, { id: 'company-12', name: '公司 13', role: '' }]
    expect(validateEditableOrganizations(thirteen, '公司')).toContain('最多添加 12 条')
    expect(validateEditableOrganizations([{ id: 'organization-0', name: ' ', role: '' }], '组织'))
      .toBe('请填写第 1 条组织经历的名称。')
  })

  it('trims the saved payload while keeping an empty role optional', () => {
    expect(normalizeEditableOrganizations([
      { id: 'company-0', name: '  示例公司  ', role: '  产品负责人  ' },
      { id: 'company-1', name: '第二家公司', role: ' ' },
    ])).toEqual([
      { name: '示例公司', role: '产品负责人' },
      { name: '第二家公司' },
    ])
  })

  it('renders independent company and organization collections in the card editor', () => {
    const page = source('src/packages/member/mip-card-edit/index.ts')
    const view = source('src/packages/member/mip-card-edit/index.wxml')
    const profileView = source('src/packages/member/mip-profile/index.wxml')

    expect(page).toContain('normalizeEditableOrganizations(this.data.companies)')
    expect(page).toContain('normalizeEditableOrganizations(this.data.organizations)')
    expect(view).toContain('wx:for="{{companies}}"')
    expect(view).toContain('wx:for="{{organizations}}"')
    for (const action of ['addExperience', 'moveExperience', 'removeExperience']) {
      expect(view).toContain(`bind:tap="${action}"`)
    }
    expect(view).toContain('bindinput="updateExperience"')
    expect(view).not.toContain('公开范围')
    expect(profileView).not.toContain('wx:for="{{companies}}"')
    expect(profileView).not.toContain('wx:for="{{organizations}}"')
  })
})
