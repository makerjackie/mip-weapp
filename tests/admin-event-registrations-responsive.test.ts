import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const recordColumns = 'minmax(0, 1.25fr) minmax(0, 1.75fr) minmax(0, 1.2fr) minmax(0, 1.25fr)'

describe('admin event registrations responsive workspace', () => {
  it('uses the shared phone, tablet, and desktop record contract', () => {
    const source = read('src/packages/admin/event-registrations/index.wxml')

    expect(source).toContain(`class="mip-admin-record-list mt-5" style="--mip-admin-record-columns: ${recordColumns};"`)
    expect(source).toContain('class="mip-admin-record-header"')
    expect(source).toContain('class="mip-admin-record-row"')
    expect(source.match(/class="mip-admin-record-cell"/g)).toHaveLength(4)
    expect(source.match(/class="mip-admin-record-label"/g)).toHaveLength(4)
    for (const label of ['参与者', '报名信息', '状态与时间', '操作']) {
      expect(source).toContain(`<view class="mip-admin-record-label">${label}</view>`)
    }
    expect(source).not.toContain('mip-admin-card-list mt-5')
  })

  it('keeps every roster fact and long user-provided value shrinkable', () => {
    const source = read('src/packages/admin/event-registrations/index.wxml')

    expect(source).toContain('class="break-all text-[length:28rpx] font-semibold">{{item.nickname}}')
    expect(source).toContain('class="mt-1 break-all whitespace-pre-wrap">{{answer.value || \'未填写\'}}')
    expect(source).toContain('联系电话：{{item.phoneNumberMasked')
    expect(source).toContain('bind:tap="revealPhone">查看完整号码')
    for (const projection of [
      'item.answerItems',
      'item.submittedText',
      'item.registeredText',
      'item.checkedInText',
      'item.statusText',
    ]) {
      expect(source).toContain(projection)
    }
    expect(source).not.toMatch(/item\.(?:ticket|scanKey|checkInToken)/)
  })

  it('preserves filtering, pagination, mutations, exports, and capability gates', () => {
    const source = read('src/packages/admin/event-registrations/index.wxml')
    const page = read('src/packages/admin/event-registrations/index.ts')

    for (const binding of [
      'bind:change="updateQuery"',
      'bind:enter="search"',
      'bind:tap="search"',
      'bind:tap="chooseStatus"',
      'bindchange="changeCreatedDate"',
      'bind:tap="clearCreatedDates"',
      'bind:tap="showPhones"',
      'bind:tap="createExport"',
      'bind:tap="reviewRegistration"',
      'bind:tap="checkIn"',
      'bind:tap="undoCheckIn"',
      'bind:tap="loadMoreRoster"',
      'bind:action="loadRoster"',
    ]) {
      expect(source).toContain(binding)
    }
    for (const operation of [
      'mipAdminModule.events.listRoster(',
      'mipAdminModule.events.reviewRegistration(',
      'mipAdminModule.events.checkIn(',
      'mipAdminModule.events.undoCheckIn(',
      'mipAdminModule.exportAndOpen(',
    ]) {
      expect(page).toContain(operation)
    }
    for (const capability of [
      'events.registrations.manage',
      'events.checkin.manage',
      'events.checkin.undo',
      'users.phone.read',
      'exports.create',
      'orders.read',
    ]) {
      expect(page).toContain(`'${capability}'`)
    }
    expect(page).toContain('expectedVersion: version')
    expect(page).toContain('!this.data.canCheckIn')
    expect(source).toContain(`canReview && item.status === 'PENDING_REVIEW'`)
    expect(source).toContain(`canCheckIn && item.status === 'REGISTERED'`)
    expect(source).toContain(`canUndoCheckIn && item.status === 'ATTENDED'`)
  })

  it('keeps the existing order/refund and check-in poster workflows behind their scopes', () => {
    const source = read('src/packages/admin/event-registrations/index.wxml')
    const page = read('src/packages/admin/event-registrations/index.ts')

    expect(source).toContain('wx:if="{{canCheckIn}}" block variant="outline" bind:tap="openCheckInTools">签到码与海报')
    expect(source).toContain('wx:if="{{canOrders}}" block variant="outline" bind:tap="openEventOrders">活动订单与退款')
    expect(page).toContain('if (!this.data.canOrders || !this.data.eventId)')
    expect(page).toContain('if (!this.data.canCheckIn || !this.data.eventId)')
    expect(page).toContain('/packages/admin/orders/index?eventId=')
    expect(page).toContain('/packages/admin/event-console/index?eventId=')
    expect(page).toContain('encodeURIComponent(this.data.eventId)')
  })

  it('retains loading, empty, error, forbidden, conflict, and disabled presentations', () => {
    const source = read('src/packages/admin/event-registrations/index.wxml')

    expect(source).toContain(`state === 'loading'`)
    expect(source).toContain(`state === 'error' || state === 'conflict'`)
    expect(source).toContain(`state === 'forbidden'`)
    expect(source).toContain('items.length === 0')
    expect(source).toContain('id="admin-event-registrations-disabled-state"')
    expect(source).toContain(`state === 'ready' && !canReview && !canCheckIn && !canUndoCheckIn`)
    expect(source).toContain('disabled="{{processingId !== \'\' || exportPending}}"')
    expect(source).toContain('wx:if="{{nextCursor}}"')
  })
})
