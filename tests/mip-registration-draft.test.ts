import { describe, expect, it } from 'vitest'
import { createRegistrationDraftStore } from '../src/modules/mip-events/registration-draft'

describe('registration draft recovery', () => {
  it('survives recreation and isolates accounts, events, and registration versions', () => {
    let value: unknown
    const storage = { read: () => value, write: (_key: string, next: unknown) => {
      value = next
    }, clear: () => {
      value = undefined
    } }
    const store = createRegistrationDraftStore(storage, () => 100)
    store.save({ userId: 'u1', eventId: 'e1', registrationVersion: null, answers: { reason: '报名内容', consent: true }, shareProfile: false })
    const restored = createRegistrationDraftStore(storage, () => 200)
    expect(restored.load('u1', 'e1', null)?.answers).toEqual({ reason: '报名内容', consent: true })
    expect(restored.load('u2', 'e1', null)).toBeNull()
    expect(restored.load('u1', 'e2', null)).toBeNull()
    expect(restored.load('u1', 'e1', 2)).toBeNull()
    restored.remove('u1', 'e1')
    expect(restored.load('u1', 'e1', null)).toBeNull()
  })

  it('expires personal answers and ignores corrupt storage', () => {
    let value: unknown
    let now = 1
    const store = createRegistrationDraftStore({ read: () => value, write: (_key, next) => {
      value = next
    }, clear: () => {
      value = undefined
    } }, () => now)
    store.save({ userId: 'u1', eventId: 'e1', registrationVersion: 3, answers: { reason: '内容' }, shareProfile: true })
    now += 7 * 24 * 60 * 60 * 1000
    expect(store.load('u1', 'e1', 3)).toBeNull()
    value = [{ userId: 'u1', eventId: 'e1', savedAt: now, answers: null }]
    expect(store.load('u1', 'e1', 3)).toBeNull()
  })
})
