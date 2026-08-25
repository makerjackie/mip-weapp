import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP admin event contract', () => {
  it('keeps the full scoped event model in the MIP admin boundary', () => {
    const types = read('src/modules/mip-admin/types.ts')
    const service = read('cloudfunctions/mip-admin-api/domain/events.js')

    expect(types).toContain('accessType: \'FREE\' | \'MEMBER_INCLUDED\' | \'PAID\'')
    expect(types).toContain('registrationPolicy: \'AUTO\' | \'APPROVAL\'')
    expect(types).toContain('scopeType: \'PLATFORM\' | \'BRANCH\'')
    expect(types).toContain('registrationDeadline: string | null')
    expect(types).toContain('cancellationDeadline: string | null')
    expect(types).toContain('waitlistEnabled: boolean')
    expect(types).toContain('priceCents: number')
    expect(service).toContain('registrationPolicy !== \'AUTO\'')
    expect(service).toContain('当前账号不能修改活动归属')
    expect(service).toContain('contentSafety')
  })

  it('uses native date controls, yuan input, and explicit scope and reservation settings', () => {
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(pageWxml).toContain('id="admin-events-page"')
    expect(pageWxml).toContain('mode="date"')
    expect(pageWxml).toContain('mode="time"')
    expect(pageWxml).toContain('城市分会活动')
    expect(pageWxml).toContain('免费报名')
    expect(pageWxml).toContain('玩家权益包含')
    expect(pageWxml).toContain('付费报名')
    expect(pageWxml).toContain('报名价格（元）')
    expect(pageWxml).toContain('人工确认')
    expect(pageWxml).toContain('名额满后启用候补')
    for (const field of ['scopeType', 'eventMode', 'accessType', 'registrationPolicy', 'albumSubmissionPolicy']) {
      expect(pageWxml).toContain(`draft.${field} ===`)
    }
    expect(pageWxml.match(/aria-role="radio"/g)?.length).toBe(12)
    expect(pageWxml.match(/min-h-\[88rpx\]/g)?.length).toBeGreaterThanOrEqual(12)
    expect(pageWxml.match(/aria-checked=/g)?.length).toBe(12)
    expect(pageWxml).toContain('box-border')
    expect(pageWxml).toContain('max-w-full')
    expect(pageWxml).not.toContain('开始时间（ISO）')
    expect(pageWxml).not.toContain('金额（分）')
    expect(pageWxml).not.toMatch(/class="[^"]*\{\{/)
    expect(pageTs).toContain('Math.round(Number(priceYuan) * 100)')
    expect(pageTs).toContain('\'draft.registrationPolicy\': \'AUTO\'')
    expect(pageTs).toContain('\'draft.waitlistEnabled\': false')
  })

  it('lets platform event operators configure the default cancellation hours', () => {
    const source = read('src/packages/admin/managed-events/index.ts')
    const view = read('src/packages/admin/managed-events/index.wxml')
    expect(source).toContain('saveEventPolicy')
    expect(source).toContain('item.capability === \'events.write\' && item.scopeType === \'PLATFORM\'')
    expect(view).toContain('默认取消报名时间')
    expect(view).toContain('cancellationHoursBeforeStart')
  })

  it('supports ordered event description image upload and preview', () => {
    const source = read('src/packages/admin/events/index.ts')
    const view = read('src/packages/admin/events/index.wxml')
    const detail = read('src/packages/member/mip-events/detail/index.wxml')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')
    expect(source).toContain('uploadImageFromPath(\'EVENT_CONTENT\'')
    expect(source).toContain('moveContentImage')
    expect(source).toContain('previewContentImage')
    expect(view).toContain('活动介绍图片')
    expect(view).toContain('updateContentCaption')
    expect(view).toContain('removeContentImage')
    expect(detail).toContain('event.contentMedia')
    expect(detail).toContain('bind:tap="previewContentImage"')
    expect(read('src/packages/member/mip-events/detail/index.ts')).toContain('wx.previewImage({ current, urls })')
    expect(gateway).toMatch(/getEvent: async eventId => resolveCloudFileUrls\([\s\S]*mip\.admin\.events\.get/)
  })

  it('blocks stale saves and requires explicit conflict recovery', () => {
    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')

    expect(pageTs).toContain('if (this.data.conflict)')
    expect(pageTs).toContain('isAdminVersionConflict(error)')
    expect(pageTs).toContain('refreshAfterConflict')
    expect(pageTs).toContain('await this.loadEvent(true)')
    expect(pageTs).toContain('expectedVersion: this.data.version')
    expect(pageWxml).toContain('活动信息已更新')
    expect(pageWxml).toContain('载入最新版本')
  })
})
