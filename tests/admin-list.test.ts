import { createAdminListController } from '@weapp/shared/admin-list'
import {
  createLabelPresenter,
  formatMinorUnits,
  formatRecordCode,
} from '@weapp/shared/presenter'
import { describe, expect, it } from 'vitest'

interface Item {
  id: string
  label: string
}

describe('shared admin list module', () => {
  it('replaces changed queries, appends unique pages, and keeps totals', async () => {
    const controller = createAdminListController<Item, { status: string }, number>({
      getId: item => item.id,
      getQueryKey: query => query.status,
      pageSize: 2,
      async loadPage({ query, cursor }) {
        if (query.status === 'archived') {
          return { items: [], nextCursor: null, totalCount: 0 }
        }
        if (cursor === null) {
          return {
            items: [{ id: '1', label: 'one' }, { id: '2', label: 'two' }],
            nextCursor: 2,
            totalCount: 3,
          }
        }
        return {
          items: [{ id: '2', label: 'two duplicate' }, { id: '3', label: 'three' }],
          nextCursor: null,
          totalCount: 3,
        }
      },
    })

    expect(await controller.refresh({ status: 'active' })).toMatchObject({
      state: 'ready',
      totalCount: 3,
      hasMore: true,
    })
    expect((await controller.loadMore()).items.map(item => item.id)).toEqual(['1', '2', '3'])
    expect(await controller.refresh({ status: 'archived' })).toMatchObject({
      state: 'empty',
      items: [],
      totalCount: 0,
    })
  })

  it('ignores stale refreshes and preserves content on background failure', async () => {
    let releaseFirst: ((value: { items: Item[], nextCursor: null }) => void) | undefined
    let failSecond = false
    const controller = createAdminListController<Item, string, string>({
      getId: item => item.id,
      getQueryKey: query => query,
      loadPage({ query }) {
        if (query === 'first') {
          return new Promise((resolve) => {
            releaseFirst = resolve
          })
        }
        if (query === 'broken' || (query === 'second' && failSecond)) {
          return Promise.reject(new Error('network'))
        }
        return Promise.resolve({
          items: [{ id: query, label: query }],
          nextCursor: null,
        })
      },
    })

    const stale = controller.refresh('first')
    await controller.refresh('second')
    releaseFirst?.({ items: [{ id: 'first', label: 'first' }], nextCursor: null })
    await stale
    expect(controller.snapshot().items.map(item => item.id)).toEqual(['second'])

    const failed = await controller.refresh('broken')
    expect(failed).toMatchObject({ state: 'error', message: 'network' })
    await controller.refresh('second')
    failSecond = true
    const backgroundFailure = await controller.refresh('second', { force: true })
    expect(backgroundFailure).toMatchObject({
      state: 'ready',
      items: [{ id: 'second', label: 'second' }],
      message: 'network，已保留上次结果。',
    })
  })
})

describe('shared admin presenter module', () => {
  it('formats transport values without leaking them into page code', () => {
    const status = createLabelPresenter({ PAID: '已支付' } as const, () => '未知状态')
    expect(status('PAID')).toBe('已支付')
    expect(status('UNKNOWN' as 'PAID')).toBe('未知状态')
    expect(formatMinorUnits(1099)).toBe('¥10.99')
    expect(formatRecordCode('order-abcdef12', { prefix: '订单' })).toBe('订单 ABCDEF12')
  })
})
