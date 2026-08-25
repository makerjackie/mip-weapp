import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP event album vertical slice', () => {
  const migration = read('database/mysql/mip/012_event_album.sql')
  const rollback = read('database/mysql/mip/rollback/012_event_album.sql')
  const eventService = read('cloudfunctions/mip-events-api/domain/event-service.js')
  const eventHandler = read('cloudfunctions/mip-events-api/index.js')
  const adminRepository = read('cloudfunctions/mip-admin-api/domain/repository.js')
  const adminService = read('cloudfunctions/mip-admin-api/domain/events.js')
  const mediaService = read('cloudfunctions/mip-media-api/domain/service.js')
  const mediaImage = read('cloudfunctions/mip-media-api/domain/image.js')

  it('adds an app-scoped soft-delete album fact and reversible event settings', () => {
    expect(migration).toContain('ADD COLUMN album_enabled')
    expect(migration).toContain('ADD COLUMN album_submission_policy')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_event_album_photos')
    expect(migration).toContain('status IN (\'PENDING\', \'PUBLISHED\', \'REJECTED\', \'WITHDRAWN\')')
    expect(migration).toContain('version BIGINT UNSIGNED NOT NULL DEFAULT 1')
    expect(migration).toContain('FOREIGN KEY (app_id, event_id)')
    expect(migration).toContain('ON DELETE RESTRICT')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(rollback).toContain('DROP TABLE IF EXISTS mip_event_album_photos')
    expect(rollback).toContain('DROP COLUMN album_submission_policy')
  })

  it('keeps publication, eligibility, media ownership, and moderation server-owned', () => {
    expect(eventHandler).toContain('\'mip.events.album.list\'')
    expect(eventHandler).toContain('\'mip.events.album.submit\'')
    expect(eventHandler).toContain('\'mip.events.album.withdraw\'')
    expect(eventService).toContain('photo.status = \'PUBLISHED\'')
    expect(eventService).toContain('[\'REGISTERED\', \'ATTENDED\'].includes(registration.status)')
    expect(eventService).toContain('owner_user_id = ? FOR UPDATE')
    expect(eventService).toContain('asset.purpose !== \'EVENT_ALBUM\'')
    expect(eventService).toContain('event.album_submission_policy === \'AUTO\' ? \'PUBLISHED\' : \'PENDING\'')
    expect(eventService).toContain('SET status = \'WITHDRAWN\'')
    expect(eventService).toContain('action: \'event.album.photo.submit\'')
    expect(eventService).toContain('action: \'event.album.photo.withdraw\'')
    expect(eventService).not.toMatch(/DELETE\s+FROM\s+mip_event_album_photos/i)
  })

  it('rechecks READY album assets during admin review and audits versioned decisions', () => {
    expect(adminService).toContain('CAPABILITIES.EVENTS_ALBUM_MANAGE')
    expect(adminService).toContain('action: \'admin.events.album.approve\'')
    expect(adminService).toContain('action: \'admin.events.album.reject\'')
    expect(adminRepository).toContain('photo.status !== \'PENDING\'')
    expect(adminRepository).toContain('eventAlbumAssetReady(photo)')
    expect(adminRepository).toContain('status = \'PENDING\' AND version = ?')
    expect(adminRepository).toContain('await writeAudit(tx, input.audit)')
    expect(adminRepository).not.toMatch(/DELETE\s+FROM\s+mip_event_album_photos/i)
  })

  it('uses the isolated album media purpose and protects active references from cleanup', () => {
    expect(mediaImage).toContain('EVENT_ALBUM: Object.freeze')
    expect(mediaImage).toContain('directory: \'event-album\'')
    expect(mediaService).toContain('FROM mip_event_album_photos photo')
    expect(mediaService).toContain('photo.status IN (\'PENDING\', \'PUBLISHED\')')
  })

  it('routes both album pages through MIP modules with client pre-compression', () => {
    const memberPage = read('src/packages/member/event-album/index.ts')
    const memberView = read('src/packages/member/event-album/index.wxml')
    const adminPage = read('src/packages/admin/event-album/index.ts')
    const eventConsole = read('src/packages/admin/event-console/index.ts')
    const eventDetail = read('src/packages/member/mip-events/detail/index.ts')
    const eventDetailView = read('src/packages/member/mip-events/detail/index.wxml')
    const appJson = read('src/app.json')
    const runtime = read('config/runtime-pages.json')

    expect(memberPage).toContain('uploadImageFromPath(\'EVENT_ALBUM\'')
    expect(memberPage).toContain('mipEventsModule.submitEventAlbumPhoto')
    expect(memberPage).toContain('mipEventsModule.withdrawEventAlbumPhoto')
    expect(memberPage).not.toContain('modules/membership')
    expect(memberView).toContain('待审核，仅自己可见')
    expect(memberView).toContain('未通过审核')
    expect(adminPage).toContain('\'events.album.manage\'')
    expect(adminPage).toContain('expectedVersion: this.data.actionVersion')
    expect(eventConsole).toContain('\'event-album\'')
    expect(eventDetail).toContain('/packages/member/event-album/index?eventId=')
    expect(eventDetailView).toContain('event.albumEnabled')
    expect(appJson).toContain('event-album/index')
    expect(runtime).toContain('calendar-location')
    expect(runtime).toContain('event-album-photo')
  })
})
