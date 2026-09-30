import type { SuperCaseDraft, SuperCaseProject } from './types'

export const MAX_SUPER_CASE_PROJECTS = 12
export const MAX_CASE_DESCRIPTION = 300

function trimmed(value: unknown, maximum: number) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result.length > maximum ? null : result
}

function isoDate(value: unknown) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) {
    return undefined
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    return null
  }
  return result
}

// 发布必填项（figma 2173_42605：设计稿未标注选填的字段）；展开讲讲为唯一选填项。
const REQUIRED_PROJECT_FIELDS: Array<{ key: keyof SuperCaseProject, label: string }> = [
  { key: 'projectName', label: '项目名称' },
  { key: 'summary', label: '一句话描述案例' },
  { key: 'startedOn', label: '开始时间' },
  { key: 'responsibility', label: '担任职责' },
  { key: 'cityTagId', label: '主营城市' },
  { key: 'region', label: '主营地区' },
  { key: 'caseType', label: '项目类型' },
]

// 收集发布缺失的必填项，用于编辑器保存前的逐项提示；草稿保存不校验。
export function collectMissingProjectFields(
  projects: Array<Partial<SuperCaseProject>>,
): string[] {
  const missing: string[] = []
  projects.forEach((project, index) => {
    const position = projects.length > 1 ? `第${index + 1}个项目：` : ''
    for (const field of REQUIRED_PROJECT_FIELDS) {
      const value = project[field.key]
      if (typeof value !== 'string' || !value.trim()) {
        missing.push(`${position}请填写${field.label}`)
      }
    }
  })
  return missing
}

function normalizeProject(value: Partial<SuperCaseProject>, publish: boolean): SuperCaseProject {
  const projectName = trimmed(value.projectName, 120)
  const summary = trimmed(value.summary, 240)
  const responsibility = trimmed(value.responsibility, 500)
  const description = trimmed(value.description, MAX_CASE_DESCRIPTION)
  const startedOn = isoDate(value.startedOn)
  const cityTagId = trimmed(value.cityTagId, 64)
  const region = trimmed(value.region, 120)
  const caseType = trimmed(value.caseType, 80)
  if ([projectName, summary, responsibility, description, startedOn, cityTagId, region, caseType]
    .includes(null)) {
    throw new Error('案例项目格式不正确')
  }
  if (publish && collectMissingProjectFields([value as Partial<SuperCaseProject>]).length > 0) {
    throw new Error('请完整填写案例项目必填项')
  }
  return {
    projectName: projectName || '',
    summary: summary || '',
    startedOn: startedOn || undefined,
    responsibility: responsibility || '',
    cityTagId: cityTagId || undefined,
    region: region || undefined,
    caseType: caseType || undefined,
    description: description || '',
  }
}

export function normalizeSuperCaseDraft(value: SuperCaseDraft): SuperCaseDraft {
  const rawProjects = value.projects?.length
    ? value.projects
    : [{
        projectName: value.projectName,
        summary: value.summary,
        startedOn: value.startedOn,
        responsibility: value.responsibility,
        cityTagId: value.cityTagId,
        region: value.region,
        caseType: value.caseType,
        description: value.description,
      }]
  if (rawProjects.length > MAX_SUPER_CASE_PROJECTS) {
    throw new Error(`最多包含 ${MAX_SUPER_CASE_PROJECTS} 个项目`)
  }
  const projects = rawProjects.map(project => normalizeProject(project, Boolean(value.publish)))
  const endedOn = isoDate(value.endedOn)
  if (endedOn === null) {
    throw new Error('结束日期格式不正确')
  }
  const mediaAssetIds = [...new Set((value.mediaAssetIds || [])
    .map(item => String(item).trim())
    .filter(Boolean))]
  if (mediaAssetIds.length > 12) {
    throw new Error('展示素材最多 12 项')
  }
  if (projects[0].startedOn && endedOn && endedOn < projects[0].startedOn) {
    throw new Error('结束日期不能早于开始日期')
  }
  const [first] = projects
  return {
    ...value,
    projectName: first.projectName,
    summary: first.summary,
    startedOn: first.startedOn,
    responsibility: first.responsibility,
    cityTagId: first.cityTagId,
    caseType: first.caseType,
    description: first.description,
    endedOn,
    projects,
    coverAssetId: trimmed(value.coverAssetId, 64) || undefined,
    mediaAssetIds,
    expectedVersion: value.expectedVersion === undefined
      ? undefined
      : Math.max(1, Math.trunc(value.expectedVersion)),
    publish: Boolean(value.publish),
  }
}
