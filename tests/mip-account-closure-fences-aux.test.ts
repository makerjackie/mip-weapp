import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function section(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
}

describe('account closure mutation fences for auxiliary user APIs', () => {
  it('locks the active caller before community target locks and writes', () => {
    const source = read('cloudfunctions/mip-community-api/domain/service.js')
    const block = section(source, 'async function setBlock', 'async function listBlocked')
    const report = section(source, 'async function reportProfile', 'async function listAnnouncements')

    expect(source).toMatch(/SELECT id, status FROM mip_users[\s\S]*WHERE app_id = \? AND id = \? FOR UPDATE/)
    expect(block.indexOf('await lockActiveCaller(tx, caller)')).toBeLessThan(block.indexOf('await targetUser(tx'))
    expect(report.indexOf('await lockActiveCaller(tx, caller)')).toBeLessThan(report.indexOf('SELECT id FROM mip_users'))
    expect(block).toContain('database.transaction(async (tx) =>')
    expect(report).toContain('database.transaction(async (tx) =>')
  })

  it('stages an uploaded object for cleanup before promoting it under the active owner lock', () => {
    const service = read('cloudfunctions/mip-media-api/domain/service.js')
    const mysql = read('cloudfunctions/mip-media-api/lib/mysql.js')
    const upload = section(service, 'async function uploadImage', 'async function cleanupOrphans')
    const cleanup = section(service, 'async function cleanupOrphans', 'return { cleanupOrphans')

    expect(upload).toContain('database.transaction(async (tx) =>')
    expect(upload.indexOf('INSERT INTO mip_media_assets')).toBeLessThan(upload.indexOf('await lockActiveUser(tx, caller)'))
    expect(upload.indexOf('await lockActiveUser(tx, caller)')).toBeLessThan(upload.indexOf('status = \'READY\''))
    expect(upload).toContain('owner_user_id IS NULL AND status = \'PENDING\'')
    expect(upload).toContain('await deleteOwnedFile(cloud')
    expect(upload).toContain('SELECT owner_user_id, status FROM mip_media_assets')
    expect(mysql).toContain('async function transaction')
    expect(cleanup).not.toContain('lockActiveUser')
  })

  it('locks the active caller before inbox and subscription grant writes while leaving reads unlocked', () => {
    const source = read('cloudfunctions/mip-notifications-api/domain/repository.js')
    const list = section(source, 'async function listInbox', 'async function markRead')
    const markRead = section(source, 'async function markRead', 'async function createGrant')
    const createGrant = section(source, 'async function createGrant', 'async function revokeGrants')
    const revokeGrants = section(source, 'async function revokeGrants', 'return { createGrant')

    expect(source).toMatch(/SELECT id, status FROM mip_users[\s\S]*WHERE app_id = \? AND id = \? FOR UPDATE/)
    for (const mutation of [markRead, createGrant, revokeGrants]) {
      expect(mutation).toContain('database.transaction(async (tx) =>')
      expect(mutation).toContain('await lockActiveUser(tx')
    }
    expect(list).not.toContain('lockActiveUser')
    expect(list).not.toContain('database.transaction')
  })
})
