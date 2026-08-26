import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const recordColumns = 'minmax(0, 1.15fr) minmax(0, 1.45fr) minmax(0, 1fr) minmax(0, 1.7fr)'

describe('admin event participants responsive workspace', () => {
  it('uses the shared phone, tablet, and desktop record contract', () => {
    const source = read('src/packages/admin/event-participants/index.wxml')

    expect(source).toContain(`class="mip-admin-record-list mt-5" style="--mip-admin-record-columns: ${recordColumns};"`)
    expect(source).toContain('class="mip-admin-record-header"')
    expect(source).toContain('class="mip-admin-record-row"')
    expect(source.match(/class="mip-admin-record-cell"/g)).toHaveLength(4)
    expect(source.match(/class="mip-admin-record-label"/g)).toHaveLength(4)
    for (const label of ['用户与联系', '活动与分会', '报名状态与时间', '报名信息与操作']) {
      expect(source).toContain(`<view class="mip-admin-record-label">${label}</view>`)
    }
    expect(source).not.toContain('mip-admin-card-list mt-5')
  })

  it('keeps long user, event, branch, and registration fields safely wrapable', () => {
    const source = read('src/packages/admin/event-participants/index.wxml')

    expect(source).toContain('class="break-all text-[length:28rpx] font-semibold">{{item.nickname}}')
    expect(source).toContain('class="break-all text-[length:25rpx] font-semibold">{{item.eventTitle}}')
    expect(source).toContain('class="mt-2 break-all text-[length:22rpx] text-muted">{{item.branchName')
    expect(source).toContain('wx:key="key" class="mt-1 break-all text-[length:22rpx]"')
    expect(source).toContain('class="box-border min-h-[88rpx] break-all rounded-[12rpx]')
  })

  it('preserves filters, capability gates, pagination, export, and roster navigation', () => {
    const source = read('src/packages/admin/event-participants/index.wxml')
    const page = read('src/packages/admin/event-participants/index.ts')

    for (const binding of [
      'bind:change="updateQuery"',
      'bind:enter="search"',
      'bindchange="chooseEvent"',
      'bindchange="chooseBranch"',
      'bindchange="chooseDate"',
      'bind:tap="togglePhone"',
      'bind:tap="chooseStatus"',
      'bind:tap="exportRows"',
      'bind:tap="search"',
      'bind:tap="openRoster"',
      'bind:tap="loadMore"',
      'bind:action="load"',
    ]) {
      expect(source).toContain(binding)
    }
    expect(source).toContain('wx:if="{{canPhone}}"')
    expect(source).toContain('wx:if="{{canExport}}"')
    expect(source).toContain('wx:if="{{nextCursor}}"')
    expect(page).toContain(`hasCapability(session.capabilities, 'users.phone.read')`)
    expect(page).toContain(`hasCapability(session.capabilities, 'exports.create')`)
    expect(page).toContain('mipAdminModule.events.listRosterAll(')
    expect(page).toContain('mipAdminModule.exportAndOpen(')
    expect(page).toContain('/packages/admin/event-registrations/index?eventId=')
    expect(page).not.toContain('mipAdminModule.gateway')
    expect(page).not.toContain('wx.cloud')
  })

  it('renders loading, empty, error, forbidden, and conflict states', () => {
    const source = read('src/packages/admin/event-participants/index.wxml')

    expect(source).toContain(`state === 'loading'`)
    expect(source).toContain(`state === 'error' || state === 'conflict'`)
    expect(source).toContain(`state === 'forbidden'`)
    expect(source).toContain('items.length === 0')
    expect(source).toContain('title="无运营权限"')
    expect(source).toContain('title="没有符合条件的参与者"')
  })

  it('keeps sensitive phone data outside page data and clears the private store on exit', () => {
    const page = read('src/packages/admin/event-participants/index.ts')

    expect(page.match(/mipAdminModule\.clearSensitive\(\)/g)).toHaveLength(2)
    expect(page).toContain('includePhone: false')
    expect(page.match(/clearPrivatePhones\(this\)/g)).toHaveLength(4)
    expect(page).toContain('seq !== this.requestSeq')
    expect(page).toContain('const { phoneNumber, ...publicItem } = item')
    expect(page).toContain(`phoneText: item.phoneBound ? '已绑定' : '未绑定'`)
  })
})
