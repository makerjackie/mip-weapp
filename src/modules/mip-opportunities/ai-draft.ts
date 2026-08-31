import type {
  OpportunityTextCityOption,
  OpportunityTextDraft,
  OpportunityTextField,
  OpportunityTextParseResult,
} from './text-parser'

const textLimits = {
  title: 120,
  valueSummary: 240,
  targetSummary: 500,
  description: 6000,
} as const

function text(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : ''
}

function normalizeCity(value: string) {
  return value.trim().replace(/[市区]$/, '').replace(/\s+/g, '').toLocaleLowerCase()
}

function matchCity(value: unknown, options: readonly OpportunityTextCityOption[]) {
  const normalized = normalizeCity(text(value, 80))
  if (!normalized) {
    return undefined
  }
  return options.find(option => option.id && normalizeCity(option.label) === normalized)
}

export function parseOpportunityAiDraft(
  value: unknown,
  cityOptions: readonly OpportunityTextCityOption[],
): OpportunityTextParseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { draft: {}, recognizedFields: [] }
  }

  const source = value as Record<string, unknown>
  const draft: OpportunityTextDraft = {}
  const recognizedFields: OpportunityTextField[] = []

  for (const field of Object.keys(textLimits) as Array<keyof typeof textLimits>) {
    const normalized = text(source[field], textLimits[field])
    if (normalized) {
      draft[field] = normalized
      recognizedFields.push(field)
    }
  }

  const city = matchCity(source.cityLabel, cityOptions)
  if (city) {
    draft.cityTagId = city.id
    draft.cityLabel = city.label
    recognizedFields.push('cityTagId')
  }

  return { draft, recognizedFields }
}
