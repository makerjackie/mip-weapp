import { describe, expect, it } from 'vitest'
import { normalizeListQuery } from './use-core-page-query'

describe('core list filter pipeline', () => {
  it('keeps only server-supported filter keys declared by the route', () => {
    const users = normalizeListQuery({
      q: '林晓',
      status: 'ACTIVE',
      filters: { createdFrom: '2030-01-01T00:00:00.000Z', kind: 'PLAYER', amountMin: '100' },
    }, 'users')
    expect(users.filters).toEqual({ createdFrom: '2030-01-01T00:00:00.000Z', kind: 'PLAYER' })

    const events = normalizeListQuery({
      filters: { startsFrom: '2030-01-01T00:00:00.000Z', priceMinCents: '1000', dateRange: 'a,b' },
    }, 'events')
    expect(events.filters).toEqual({ startsFrom: '2030-01-01T00:00:00.000Z', priceMinCents: '1000' })

    const orders = normalizeListQuery({
      filters: { orderType: 'EVENT', priceMinCents: '1000', createdTo: '2030-01-31T23:59:59.999Z' },
    }, 'orders')
    expect(orders.filters).toEqual({ orderType: 'EVENT', createdTo: '2030-01-31T23:59:59.999Z' })
  })

  it('omits an empty filters map so requests stay identical to before', () => {
    const query = normalizeListQuery({ q: '  ', status: '', filters: {} }, 'users')
    expect(query.filters).toBeUndefined()
    expect(query.query).toBe('')
    expect(query.limit).toBe(20)
  })
})
