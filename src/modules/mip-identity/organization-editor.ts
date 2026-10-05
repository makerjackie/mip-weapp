import type { ProfileOrganization } from './contracts'

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

/**
 * 编辑页固定首行输入（公司/职位、组织/职位）的写入入口。
 *
 * 空资料时列表为空，但首行输入仍绑定 `companies[0]`/`organizations[0]`：
 * 先落一行空行再写入，否则 updateEditableOrganization 原样返回空数组，
 * 输入会被 value 绑定立即清空。唯一一行被清空时回退为空数组，保存即视为不填该段经历。
 */
export function editExperienceRow(
  items: EditableProfileOrganization[],
  index: number,
  field: 'name' | 'role',
  value: string,
  id: string,
): EditableProfileOrganization[] {
  const source = items.length === 0 && index === 0
    ? [{ id, name: '', role: '' }]
    : items
  const updated = updateEditableOrganization(source, index, field, value)
  const soleRowCleared = updated.length === 1 && !updated[0]!.name.trim() && !updated[0]!.role.trim()
  return soleRowCleared ? [] : updated
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
