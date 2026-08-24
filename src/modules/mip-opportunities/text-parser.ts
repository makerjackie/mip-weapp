export type OpportunityTextField = 'title' | 'valueSummary' | 'cityTagId' | 'targetSummary' | 'description'

export interface OpportunityTextCityOption {
  id: string
  label: string
}

export interface OpportunityTextDraft {
  title?: string
  valueSummary?: string
  cityTagId?: string
  cityLabel?: string
  targetSummary?: string
  description?: string
}

export interface OpportunityTextParseResult {
  draft: OpportunityTextDraft
  recognizedFields: OpportunityTextField[]
}

const fieldAliases: Record<Exclude<OpportunityTextField, 'cityTagId'> | 'city', string[]> = {
  title: ['项目名称', '机会名称', '项目标题', '机会标题'],
  valueSummary: ['价值金额', '机会价值', '项目价值', '价值说明'],
  city: ['主营城市', '所在城市', '城市'],
  targetSummary: ['寻找合作方', '合作需求', '寻找', '需要资源'],
  description: ['展开讲讲', '项目介绍', '详细介绍', '机会详情'],
}

function normalizedLabel(value: string) {
  return value
    .replace(/\s/g, '')
    .replaceAll('【', '')
    .replaceAll('】', '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/[（(][^）)]*[）)]/g, '')
}

function fieldForLabel(label: string) {
  const normalized = normalizedLabel(label)
  return (Object.entries(fieldAliases) as Array<[keyof typeof fieldAliases, string[]]>)
    .find(([, aliases]) => aliases.includes(normalized))?.[0]
}

function bounded(value: string, maxLength: number) {
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : ''
}

function normalizeCity(value: string) {
  return value.trim().replace(/[市区]$/, '').replace(/\s+/g, '').toLocaleLowerCase()
}

function matchCity(value: string, options: readonly OpportunityTextCityOption[]) {
  const normalized = normalizeCity(value)
  if (!normalized) {
    return undefined
  }
  return options.find(option => option.id && normalizeCity(option.label) === normalized)
}

export function parseOpportunityText(
  source: string,
  cityOptions: readonly OpportunityTextCityOption[],
): OpportunityTextParseResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  const sections: Partial<Record<keyof typeof fieldAliases, string[]>> = {}
  const unlabeled: string[] = []
  let activeField: keyof typeof fieldAliases | undefined

  for (const line of lines) {
    const separators = [line.indexOf(':'), line.indexOf('：')].filter(index => index >= 0)
    const separator = separators.length ? Math.min(...separators) : -1
    const label = separator > 0 && separator <= 16 ? line.slice(0, separator) : ''
    const field = label ? fieldForLabel(label) : undefined
    if (field) {
      activeField = field
      sections[field] ||= []
      const value = line.slice(separator + 1).trim()
      if (value) {
        sections[field]?.push(value)
      }
      continue
    }
    if (separator >= 0) {
      activeField = undefined
      unlabeled.push(line)
      continue
    }
    if (activeField) {
      sections[activeField] ||= []
      sections[activeField]?.push(line)
    }
    else {
      unlabeled.push(line)
    }
  }

  const draft: OpportunityTextDraft = {}
  const recognizedFields: OpportunityTextField[] = []
  const title = bounded(sections.title?.join(' ') || (!Object.keys(sections).length ? unlabeled[0] || '' : ''), 120)
  if (title) {
    draft.title = title
    recognizedFields.push('title')
  }
  const valueSummary = bounded(sections.valueSummary?.join('\n') || '', 240)
  if (valueSummary) {
    draft.valueSummary = valueSummary
    recognizedFields.push('valueSummary')
  }
  const city = matchCity(sections.city?.join(' ') || '', cityOptions)
  if (city) {
    draft.cityTagId = city.id
    draft.cityLabel = city.label
    recognizedFields.push('cityTagId')
  }
  const targetSummary = bounded(sections.targetSummary?.join('\n') || '', 500)
  if (targetSummary) {
    draft.targetSummary = targetSummary
    recognizedFields.push('targetSummary')
  }
  const unlabeledDescription = !Object.keys(sections).length ? unlabeled.slice(1).join('\n') : ''
  const description = bounded(sections.description?.join('\n') || unlabeledDescription, 6000)
  if (description) {
    draft.description = description
    recognizedFields.push('description')
  }
  return { draft, recognizedFields }
}
