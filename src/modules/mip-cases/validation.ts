import type { SuperCaseDraft } from './types'

function normalizedText(value: unknown, maximum: number, label: string, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) {
    throw new Error(`${label}格式不正确`)
  }
  return result
}

function isoDate(value: unknown, label: string) {
  const result = normalizedText(value, 10, label, false)
  if (!result) {
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`${label}格式不正确`)
  }
  return result
}

export function normalizeSuperCaseDraft(value: SuperCaseDraft): SuperCaseDraft {
  const startedOn = isoDate(value.startedOn, '开始日期')
  const endedOn = isoDate(value.endedOn, '结束日期')
  if (startedOn && endedOn && endedOn < startedOn) {
    throw new Error('结束日期不能早于开始日期')
  }
  const mediaAssetIds = [...new Set((value.mediaAssetIds || [])
    .map(item => String(item).trim())
    .filter(Boolean))]
  if (mediaAssetIds.length > 12) {
    throw new Error('展示素材最多 12 项')
  }
  return {
    ...value,
    projectName: normalizedText(value.projectName, 120, '项目名称'),
    summary: normalizedText(value.summary, 240, '一句话说明'),
    startedOn,
    endedOn,
    responsibility: normalizedText(value.responsibility, 500, '职责'),
    cityTagId: normalizedText(value.cityTagId, 64, '城市', false) || undefined,
    industryTagId: normalizedText(value.industryTagId, 64, '行业', false) || undefined,
    caseType: normalizedText(value.caseType, 80, '案例类型', false) || undefined,
    description: normalizedText(value.description, 8000, '详细说明'),
    coverAssetId: normalizedText(value.coverAssetId, 64, '封面', false) || undefined,
    mediaAssetIds,
    expectedVersion: value.expectedVersion === undefined
      ? undefined
      : Math.max(1, Math.trunc(value.expectedVersion)),
    publish: Boolean(value.publish),
  }
}
