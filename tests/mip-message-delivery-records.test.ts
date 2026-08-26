import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localDayBoundary,
  parseMessageDeliveryRecordPage,
} from '../src/modules/mip-admin/message-delivery-records'

const root = path.resolve(import.meta.dirname, '..')

describe('MIP message delivery records', () => {
  it('parses safe operational delivery facts without raw identifiers or payloads', () => {
    const page = parseMessageDeliveryRecordPage({
      items: [{
        recordKey: '576f18824476444ff24b',
        channel: 'WECHAT_SUBSCRIPTION',
        status: 'FAILED',
        attempts: 2,
        lastErrorCode: 'DELIVERY_TEMPORARY',
        availableAt: '2030-08-25T10:00:00.000Z',
        deliveredAt: null,
        createdAt: '2030-08-25T10:00:00.000Z',
        updatedAt: '2030-08-25T10:00:00.000Z',
        occurredAt: '2030-08-25T10:00:00.000Z',
        title: '活动提醒',
        eventTitle: '城市见面会',
        campaignName: '八月提醒',
        nickname: '小明',
        playerNumber: 18,
        branchName: '武汉分会',
      }],
      nextCursor: null,
    })
    expect(page.items[0].playerNumber).toBe(18)
    expect(JSON.stringify(page)).not.toMatch(/openid|payload|ciphertext|provider|10000000-/iu)
    expect(() => parseMessageDeliveryRecordPage({ items: [{ recordKey: 'not-safe' }], nextCursor: null })).toThrow('消息投递记录')
    expect(() => parseMessageDeliveryRecordPage({ items: [], nextCursor: null, debug: true })).toThrow('消息投递记录')
    expect(() => parseMessageDeliveryRecordPage({ items: [], nextCursor: 'x'.repeat(513) })).toThrow('消息投递记录')
  })

  it('uses an exclusive next-day boundary for the end-date filter', () => {
    expect(Date.parse(localDayBoundary('2030-08-01') || '')).toBeLessThan(Date.parse(localDayBoundary('2030-08-01', 1) || ''))
  })

  it('registers the responsive records page and navigation destination', () => {
    const page = fs.readFileSync(path.join(root, 'src/packages/admin/message-delivery-records/index.wxml'), 'utf8')
    const script = fs.readFileSync(path.join(root, 'src/packages/admin/message-delivery-records/index.ts'), 'utf8')
    const nav = fs.readFileSync(path.join(root, 'src/packages/admin/components/workspace-nav/model.ts'), 'utf8')
    expect(page).toContain('搜索消息标题、活动、昵称或玩家编号')
    expect(page).toContain('加载更多')
    expect(page).toContain('mip-admin-section-grid')
    expect(script).toContain('listDeliveryRecords')
    expect(nav).toContain('packages/admin/message-delivery-records/index')
  })
})
