import { createHash } from 'node:crypto'

function stableId(appId, key) {
  const hex = createHash('sha256').update(`${appId}\0feishu-catalog\0${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// Exact names only: retain IDs already referenced by profiles and opportunities.
// Unmatched legacy entries remain available; no fuzzy merge, deletion or grants.
export function buildFeishuCatalog({ appId, industries, cities, badges, existingTags, existingBadges }) {
  const tags = []
  const groups = new Map()
  function tag(kind, label, sourceKey, parentId, popular, selectable = true) {
    const matches = existingTags.filter(row => row.kind === kind && row.label === label && Boolean(Number(row.selectable)) === selectable)
    if (matches.length > 1) {
      throw new Error(`Ambiguous existing catalog label: ${kind}/${label}`)
    }
    const prior = matches[0]
    const item = {
      id: prior?.id || stableId(appId, sourceKey),
      kind,
      label,
      key: prior?.tag_key || `feishu_${sourceKey}`,
      parentId,
      popular,
      selectable,
      sortOrder: tags.length,
    }
    if (tags.some(row => row.id === item.id)) {
      throw new Error(`Duplicate source label: ${kind}/${label}`)
    }
    tags.push(item)
    return item
  }
  for (const record of industries.records) {
    const value = record.values
    if (value['一级分类'] === '不限' && value['二级分类'] === '-') {
      continue
    }
    const groupName = value['一级分类']
    if (!groups.has(groupName)) {
      const groupKey = createHash('sha256').update(groupName).digest('hex').slice(0, 20)
      groups.set(groupName, tag('INDUSTRY', groupName, `industry_group_${groupKey}`, null, false, false))
    }
    tag('INDUSTRY', value['二级分类'], record.recordId, groups.get(groupName).id, value['热门行业'] === true)
  }
  for (const record of cities.records) {
    const label = record.values['城市名（二级分类）']
    // 全国 is the existing NATIONAL location scope, never a geocodable city.
    if (label === '全国') {
      continue
    }
    tag('CITY', label, record.recordId, null, record.values['热门城市'] === true)
  }
  const badgeItems = badges.records.map((record, index) => {
    const value = record.values
    const name = value['徽章名称']
    const matches = existingBadges.filter(row => row.name === name)
    if (matches.length > 1) {
      throw new Error(`Ambiguous existing badge name: ${name}`)
    }
    const prior = matches[0]
    return {
      id: prior?.id || stableId(appId, record.recordId),
      key: prior?.badge_key || `feishu_${record.recordId}`,
      name,
      description: value['一句话简介（用户视角）'],
      category: 'IDENTITY',
      status: value['是否上线'] === true ? 'ACTIVE' : 'DRAFT',
      sortOrder: index,
    }
  })
  return { tags, badges: badgeItems }
}
