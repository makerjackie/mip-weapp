import type { AdminOpportunity, AdminOpportunityCommercialTerms, AdminOpportunityDetail, AdminPage } from './types'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('机会服务返回了无效响应')
  }
  return value as Record<string, unknown>
}

function commercialTerms(value: unknown): AdminOpportunityCommercialTerms | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const source = record(value)
  if (source.currency !== 'CNY' || source.amountUnit !== 'CNY_CENTS'
    || typeof source.amountDisplay !== 'string' || typeof source.locationDisplay !== 'string'
    || !Array.isArray(source.locations)) {
    throw new Error('机会服务返回了无效响应')
  }
  const min = source.minAmountCents === undefined ? undefined : Number(source.minAmountCents)
  const max = source.maxAmountCents === undefined ? undefined : Number(source.maxAmountCents)
  if ((min !== undefined && (!Number.isSafeInteger(min) || min < 0))
    || (max !== undefined && (!Number.isSafeInteger(max) || max < 0))
    || (min !== undefined && max !== undefined && min > max)) {
    throw new Error('机会服务返回了无效响应')
  }
  const seen = new Set<string>()
  const locations = source.locations.map((item) => {
    const location = record(item)
    const type = String(location.type || '')
    if (!['CITY', 'NATIONAL', 'REMOTE'].includes(type)) {
      throw new Error('机会服务返回了无效响应')
    }
    if (type === 'CITY') {
      if (typeof location.cityTagId !== 'string' || !location.cityTagId || typeof location.cityName !== 'string') {
        throw new Error('机会服务返回了无效响应')
      }
      const key = `CITY:${location.cityTagId}`
      if (seen.has(key)) {
        throw new Error('机会服务返回了无效响应')
      }
      seen.add(key)
      return { type: 'CITY' as const, cityTagId: location.cityTagId, cityName: location.cityName }
    }
    if (seen.has(type)) {
      throw new Error('机会服务返回了无效响应')
    }
    seen.add(type)
    return { type: type as 'NATIONAL' | 'REMOTE' }
  })
  return {
    currency: 'CNY',
    amountUnit: 'CNY_CENTS',
    ...(min === undefined ? {} : { minAmountCents: min }),
    ...(max === undefined ? {} : { maxAmountCents: max }),
    amountDisplay: source.amountDisplay,
    locationDisplay: source.locationDisplay,
    locations,
  }
}

export function parseAdminOpportunity(value: unknown): AdminOpportunity {
  const source = record(value)
  return { ...source, commercialTerms: commercialTerms(source.commercialTerms) } as AdminOpportunity
}

export function parseAdminOpportunityPage(value: unknown): AdminPage<AdminOpportunity> {
  const source = record(value)
  if (!Array.isArray(source.items)
    || !(source.nextCursor === undefined || source.nextCursor === null || typeof source.nextCursor === 'string')) {
    throw new Error('机会服务返回了无效响应')
  }
  return { items: source.items.map(parseAdminOpportunity), nextCursor: source.nextCursor }
}

export function parseAdminOpportunityDetail(value: unknown): AdminOpportunityDetail {
  return parseAdminOpportunity(value) as AdminOpportunityDetail
}
