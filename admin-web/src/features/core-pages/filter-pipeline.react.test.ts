import { describe, expect, it } from 'vitest'
import { normalizeListQuery } from './use-core-page-query'
import { loadAdminReadPage, type AdminRequest } from '../../modules/admin-read-pages'

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

  it('preserves the selected level from the destination URL through the actual user-list request and pagination', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const request: AdminRequest = async <T>(action: string, input?: unknown) => {
      calls.push({ action, input })
      return { items: [{ id: 'user-a', nickname: '等级用户', levelName: 'Lv.1' }], nextCursor: 'page-2' } as T
    }
    const search = { status: 'ACTIVE', filters: { levelId: 'level-1', unsupported: 'ignored' } }
    const firstQuery = normalizeListQuery(search, 'users')
    const page = await loadAdminReadPage('users', firstQuery, request)
    expect(firstQuery.filters).toEqual({ levelId: 'level-1' })
    expect(calls[0]).toEqual({ action: 'mip.admin.users.list', input: {
      filters: { query: '', status: 'ACTIVE', levelId: 'level-1' }, limit: 20, cursor: undefined,
    } })
    expect(page.sections[0].rows[0].level).toBe('Lv.1')
    expect(page.nextCursor).toBe('page-2')
    await loadAdminReadPage('users', normalizeListQuery({ ...search, cursor: page.nextCursor! }, 'users'), request)
    expect(calls[1]).toEqual({ action: 'mip.admin.users.list', input: {
      filters: { query: '', status: 'ACTIVE', levelId: 'level-1' }, limit: 20, cursor: 'page-2',
    } })
    expect(normalizeListQuery({ ...search, filters: { levelId: 'level-8' } }, 'users').filters).toEqual({ levelId: 'level-8' })
  })
})
