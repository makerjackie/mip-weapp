import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('admin event repository architecture', () => {
  it('keeps event persistence behind one composed repository factory', () => {
    const rootRepository = read('cloudfunctions/mip-admin-api/domain/repository.js')
    const eventRepository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')

    expect(rootRepository).toContain('const { createAdminEventRepository } = require(\'./repositories/events\')')
    expect(rootRepository).toContain('const eventRepository = createAdminEventRepository(database, {')
    expect(rootRepository).toContain('...eventRepository')
    expect(eventRepository).toContain('function createAdminEventRepository(database, dependencies)')
    expect(eventRepository).toContain('module.exports = { createAdminEventRepository }')

    const extractedMethods = [
      'getEventScope',
      'listEvents',
      'getEvent',
      'getEventPolicy',
      'saveEventPolicy',
      'listEventAlbumPhotos',
      'reviewEventAlbumPhoto',
      'saveEvent',
      'cloneEvent',
      'changeEventStatus',
      'publishEventReminder',
      'listRoster',
      'reviewRegistration',
      'checkIn',
      'undoCheckIn',
    ]
    for (const method of extractedMethods) {
      expect(eventRepository).toContain(`async function ${method}`)
      expect(rootRepository).not.toContain(`async function ${method}`)
    }
  })

  it('keeps the extracted module free of physical business deletes', () => {
    const eventRepository = read('cloudfunctions/mip-admin-api/domain/repositories/events.js')
    expect(eventRepository).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(eventRepository).not.toMatch(
      /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:member|dating|sewing)_\w+/i,
    )
  })
})
