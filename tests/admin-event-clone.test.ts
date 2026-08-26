import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
function readOptional(relativePath: string) {
  const absolutePath = path.join(root, relativePath)
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : ''
}

describe('admin event clone contract', () => {
  it('uses a scoped, versioned and idempotent server operation', () => {
    const operations = read('cloudfunctions/mip-admin-api/domain/operations/events.js')
    const eventDomain = [
      read('cloudfunctions/mip-admin-api/domain/service.js'),
      readOptional('cloudfunctions/mip-admin-api/domain/events.js'),
    ].join('\n')
    const repository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    const gateway = read('src/modules/mip-admin/cloudbase-gateway.ts')

    expect(operations).toContain('\'mip.admin.events.clone\'')
    expect(eventDomain).toContain('eventAuthorization(context, sourceEventId, CAPABILITIES.EVENTS_WRITE)')
    expect(eventDomain).toContain('expectedVersion(input.expectedVersion)')
    expect(eventDomain).toContain('normalizeIdempotencyKey(input.idempotencyKey)')
    expect(gateway).toContain('call(\'mip.admin.events.clone\'')
    expect(repository).toContain('const operation = \'admin.events.clone\'')
    expect(repository).toContain('status: \'DRAFT\'')
    const cloneService = eventDomain.slice(
      eventDomain.indexOf('async function cloneEvent'),
      eventDomain.indexOf('async function changeEventStatus'),
    )
    const cloneRepository = repository.slice(
      repository.indexOf('async function cloneEvent'),
      repository.indexOf('async function changeEventStatus'),
    )
    expect(cloneService).not.toContain('source.version !== version')
    expect(cloneService).toContain('grant.scopeType === \'EVENT\'')
    expect(cloneRepository).toContain('authorization.effectiveGrant.scopeType === \'EVENT\'')
    expect(cloneRepository.indexOf('INSERT INTO mip_idempotency_keys'))
      .toBeLessThan(cloneRepository.indexOf('Number(source.version) !== input.expectedVersion'))
  })

  it('keeps retry identities and states exactly which records are not copied', () => {
    const consolePage = read('src/packages/admin/event-console/index.ts')
    const consoleView = read('src/packages/admin/event-console/index.wxml')
    const listPage = read('src/packages/admin/managed-events/index.ts')
    const listView = read('src/packages/admin/managed-events/index.wxml')

    expect(consolePage).toContain('cloneRequestKey')
    expect(consolePage).toContain('cloneRequestVersion')
    expect(consolePage).toMatch(/const expectedVersion = retrying[\s\S]*this\.data\.cloneRequestVersion[\s\S]*event\.version/)
    expect(consolePage).toContain('报名、订单、签到、相册和消息不会复制')
    expect(consoleView).toContain('复制为草稿')
    expect(listPage).toContain('mipAdminModule.events.clone({')
    expect(listPage).not.toContain('mipAdminModule.gateway')
    expect(listPage).not.toContain('mipAdminModule.mutate')
    expect(listPage).toContain('cloneRequests: {} as Record<string, CloneRequest>')
    expect(listPage).toContain('expectedVersion: request.expectedVersion')
    expect(listView).toContain('catch:tap="cloneEvent"')
    expect(listView).toContain('loading="{{cloneBusyId === item.id}}"')
  })

  it('offers cloning only to platform or covering branch grants while preserving event editing', () => {
    const consolePage = read('src/packages/admin/event-console/index.ts')
    const consoleView = read('src/packages/admin/event-console/index.wxml')
    const listPage = read('src/packages/admin/managed-events/index.ts')
    const listClonePermission = listPage.slice(
      listPage.indexOf('function canCloneEvent'),
      listPage.indexOf('Page({'),
    )
    const consoleClonePermissionStart = consolePage.indexOf('canClone: session.capabilities.some')
    const consoleClonePermission = consolePage.slice(
      consoleClonePermissionStart,
      consolePage.indexOf('canRoster:', consoleClonePermissionStart),
    )

    for (const permission of [listClonePermission, consoleClonePermission]) {
      expect(permission).toContain('item.scopeType === \'PLATFORM\'')
      expect(permission).toContain('item.scopeType === \'BRANCH\'')
      expect(permission).not.toContain('item.scopeType === \'EVENT\'')
    }
    expect(consolePage).toContain('!this.data.canClone')
    expect(consoleView).toContain('wx:if="{{canClone}}"')
    expect(consoleView).toContain('wx:if="{{canEdit}}"')
  })

  it('blocks double taps, retains uncertain requests, and recovers loading state', () => {
    const pages = [
      read('src/packages/admin/managed-events/index.ts'),
      read('src/packages/admin/event-console/index.ts'),
    ]
    for (const page of pages) {
      expect(page).toContain('cloneConfirmationBusy')
      expect(page).toMatch(/cloneConfirmationBusy = true[\s\S]*showModal/)
      expect(page).toMatch(/finally \{[\s\S]*cloneConfirmationBusy = false/)
      expect(page).toContain('再次点击复制可安全重试')
      expect(page).toContain('活动时间已自动顺延，请复核活动标题和时间。')
      expect(page).toContain('error instanceof MipAdminError && !error.retryable')
      expect(page.indexOf('error instanceof MipAdminError && !error.retryable'))
        .toBeLessThan(page.indexOf('再次点击复制可安全重试'))
    }
    expect(pages[0]).toMatch(/const pending = this\.data\.cloneRequests\[eventId\][\s\S]*pending \|\| \{[\s\S]*expectedVersion: displayedVersion/)
    expect(pages[0]).toMatch(/isAdminVersionConflict\(error\)[\s\S]*withoutCloneRequest/)
    expect(pages[0]).toMatch(/error instanceof MipAdminError && !error\.retryable\)[\s\S]*withoutCloneRequest/)
    expect(pages[1]).toMatch(/isAdminVersionConflict\(error\)[\s\S]*cloneRequestKey: ''/)
    expect(pages[1]).toMatch(/error instanceof MipAdminError && !error\.retryable\)[\s\S]*cloneRequestKey: ''/)
  })
})
