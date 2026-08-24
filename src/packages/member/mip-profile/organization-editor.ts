import type { ProfileOrganization } from '../../../modules/mip-identity'

export const MAX_PROFILE_ORGANIZATIONS = 12

export interface EditableProfileOrganization {
  id: string
  name: string
  role: string
}

export function createEditableOrganizations(
  source: ProfileOrganization[],
  id: (index: number) => string,
): EditableProfileOrganization[] {
  return source.map((item, index) => ({
    id: id(index),
    name: item.name,
    role: item.role || '',
  }))
}

export function appendEditableOrganization(
  source: EditableProfileOrganization[],
  id: string,
): EditableProfileOrganization[] {
  if (source.length >= MAX_PROFILE_ORGANIZATIONS) {
    return source
  }
  return [...source, { id, name: '', role: '' }]
}

export function updateEditableOrganization(
  source: EditableProfileOrganization[],
  index: number,
  field: 'name' | 'role',
  value: string,
): EditableProfileOrganization[] {
  if (!source[index]) {
    return source
  }
  return source.map((item, itemIndex) => itemIndex === index
    ? { ...item, [field]: value }
    : item)
}

export function removeEditableOrganization(
  source: EditableProfileOrganization[],
  index: number,
): EditableProfileOrganization[] {
  return source.filter((_, itemIndex) => itemIndex !== index)
}

export function moveEditableOrganization(
  source: EditableProfileOrganization[],
  index: number,
  direction: -1 | 1,
): EditableProfileOrganization[] {
  const targetIndex = index + direction
  if (!source[index] || targetIndex < 0 || targetIndex >= source.length) {
    return source
  }
  const result = [...source]
  const current = result[index]
  result[index] = result[targetIndex]!
  result[targetIndex] = current!
  return result
}

export function validateEditableOrganizations(
  source: EditableProfileOrganization[],
  label: '公司' | '组织',
): string | null {
  if (source.length > MAX_PROFILE_ORGANIZATIONS) {
    return `${label}经历最多添加 ${MAX_PROFILE_ORGANIZATIONS} 条。`
  }
  for (const [index, item] of source.entries()) {
    const name = item.name.trim()
    const role = item.role.trim()
    if (!name) {
      return `请填写第 ${index + 1} 条${label}经历的名称。`
    }
    if (name.length > 120) {
      return `第 ${index + 1} 条${label}经历的名称不能超过 120 个字。`
    }
    if (role.length > 80) {
      return `第 ${index + 1} 条${label}经历的角色不能超过 80 个字。`
    }
  }
  return null
}

export function normalizeEditableOrganizations(
  source: EditableProfileOrganization[],
): ProfileOrganization[] {
  return source.map(item => ({
    name: item.name.trim(),
    ...(item.role.trim() ? { role: item.role.trim() } : {}),
  }))
}
