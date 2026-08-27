import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSeedCollisionQuery,
  buildSeedOwnershipQuery,
} from '../scripts/lib/mip-seed-safety.mjs'

const root = path.resolve(import.meta.dirname, '..')
const seed = JSON.parse(fs.readFileSync(
  path.join(root, 'database/mysql/mip/seed.demo.json'),
  'utf8',
))
const script = fs.readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf8')
const focalUserId = '50000000-0000-4000-8000-000000000001'

describe('MIP demo user influence fixtures', () => {
  it('provides a focal user with both invitation and heart directions', () => {
    const influence = seed.userInfluence
    expect(influence.eventInvitationAttributions).toHaveLength(2)
    expect(influence.eventHearts).toHaveLength(2)
    expect(influence.eventInvitationAttributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ guestUserId: focalUserId, sourceType: 'USER' }),
      expect.objectContaining({ inviterUserId: focalUserId, sourceType: 'USER' }),
    ]))
    expect(influence.eventHearts).toEqual(expect.arrayContaining([
      expect.objectContaining({ voterUserId: focalUserId, status: 'ACTIVE' }),
      expect.objectContaining({ targetUserId: focalUserId, status: 'ACTIVE' }),
    ]))
  })

  it('provides read, unread, incoming, and outgoing profile visit states', () => {
    const visits = seed.userInfluence.profileVisits
    expect(visits).toHaveLength(3)
    expect(visits).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileUserId: focalUserId, readAt: null }),
      expect.objectContaining({ profileUserId: focalUserId, readAt: expect.any(String) }),
      expect.objectContaining({ visitorUserId: focalUserId, readAt: expect.any(String) }),
    ]))
  })

  it('references only existing demo users, events, and matching registrations', () => {
    const userIds = new Set(seed.users.map((item: { id: string }) => item.id))
    const eventIds = new Set(seed.events.map((item: { id: string }) => item.id))
    const registrationById = new Map(seed.eventRegistrations.map((item: { id: string }) => (
      [item.id, item]
    )))
    const registeredPairs = new Set(seed.eventRegistrations.map((item: {
      eventId: string
      userId: string
    }) => `${item.eventId}:${item.userId}`))

    for (const item of seed.userInfluence.eventInvitationAttributions) {
      const registration = registrationById.get(item.registrationId)
      const event = seed.events.find((candidate: { id: string }) => candidate.id === item.eventId)
      expect(registration).toMatchObject({ eventId: item.eventId, userId: item.guestUserId })
      expect(registration.registeredAt).toBe(item.capturedAt)
      expect(item.capturedAt >= event.registrationOpensAt).toBe(true)
      expect(item.capturedAt <= event.registrationDeadline).toBe(true)
      expect(userIds.has(item.inviterUserId)).toBe(true)
    }
    for (const item of seed.userInfluence.eventHearts) {
      expect(eventIds.has(item.eventId)).toBe(true)
      expect(registeredPairs.has(`${item.eventId}:${item.voterUserId}`)).toBe(true)
      expect(registeredPairs.has(`${item.eventId}:${item.targetUserId}`)).toBe(true)
    }
    for (const item of seed.userInfluence.profileVisits) {
      expect(userIds.has(item.visitorUserId)).toBe(true)
      expect(userIds.has(item.profileUserId)).toBe(true)
      expect(item.visitorUserId).not.toBe(item.profileUserId)
    }
  })

  it('backs active hearts with an ended event and complete attended check-in facts', () => {
    const historicalEvent = seed.events.find((item: {
      key: string
    }) => item.key === 'demo_event_2026_interaction')
    expect(historicalEvent).toMatchObject({ status: 'ENDED' })
    expect(historicalEvent.endedAt >= historicalEvent.endsAt).toBe(true)
    expect(seed.events.filter((item: { startsAt: string }) => item.startsAt.startsWith('2030-')))
      .toHaveLength(2)

    const registrations = seed.eventRegistrations.filter((item: {
      eventId: string
    }) => item.eventId === historicalEvent.id)
    expect(registrations).toHaveLength(3)
    expect(registrations.every((item: { status: string, version: number }) => (
      item.status === 'ATTENDED' && item.version === 2
    ))).toBe(true)

    const registrationByPair = new Map(registrations.map((item: {
      eventId: string
      userId: string
    }) => [`${item.eventId}:${item.userId}`, item]))
    const checkinByRegistration = new Map(seed.eventCheckins.map((item: {
      registrationId: string
    }) => [item.registrationId, item]))
    const transitionByCheckin = new Map(seed.eventCheckinTransitions.map((item: {
      checkinId: string
    }) => [item.checkinId, item]))
    expect(seed.eventCheckins).toHaveLength(3)
    expect(seed.eventCheckinTransitions).toHaveLength(3)

    for (const registration of registrations) {
      const checkin = checkinByRegistration.get(registration.id)
      const transition = transitionByCheckin.get(checkin.id)
      expect(checkin).toMatchObject({
        eventId: historicalEvent.id,
        userId: registration.userId,
        source: 'ADMIN',
        status: 'ACTIVE',
        version: 1,
      })
      expect(transition).toMatchObject({
        registrationId: registration.id,
        eventId: historicalEvent.id,
        userId: registration.userId,
        transitionType: 'CHECKED_IN',
        checkinVersion: checkin.version,
        registrationVersion: registration.version,
        source: checkin.source,
        occurredAt: checkin.checkedInAt,
      })
    }

    for (const heart of seed.userInfluence.eventHearts) {
      const voterRegistration = registrationByPair.get(`${heart.eventId}:${heart.voterUserId}`)
      const targetRegistration = registrationByPair.get(`${heart.eventId}:${heart.targetUserId}`)
      const voterCheckin = checkinByRegistration.get(voterRegistration.id)
      const targetCheckin = checkinByRegistration.get(targetRegistration.id)
      expect(heart.eventId).toBe(historicalEvent.id)
      expect(voterRegistration.status).toBe('ATTENDED')
      expect(targetRegistration.status).toBe('ATTENDED')
      expect(heart.occurredAt > voterCheckin.checkedInAt).toBe(true)
      expect(heart.occurredAt > targetCheckin.checkedInAt).toBe(true)
      expect(heart.occurredAt >= historicalEvent.endedAt).toBe(true)
    }
  })

  it('keeps all influence rows under ownership, collision, manifest, and AppID guards', () => {
    const appId = 'wx1111111111111111'
    const ownership = buildSeedOwnershipQuery(appId, seed)
    const collision = buildSeedCollisionQuery(appId, seed)
    for (const table of [
      'mip_event_checkins',
      'mip_event_checkin_transitions',
      'mip_event_invitation_attributions',
      'mip_event_hearts',
      'mip_profile_visits',
    ]) {
      expect(ownership).toContain(table)
      expect(script).toContain(`INSERT INTO ${table}`)
      expect(script).toContain(`${table}:`)
    }
    expect(collision).toContain('\'$.recordsByTable.mip_event_checkins\'')
    expect(collision).toContain('\'$.recordsByTable.mip_event_checkin_transitions\'')
    for (const table of [
      'mip_event_invitation_attributions',
      'mip_event_hearts',
      'mip_profile_visits',
    ]) {
      expect(collision).toContain(`'$.recordsByTable.${table}'`)
    }
    expect(collision).toContain('event_id =')
    expect(collision).toContain('voter_user_id =')
    expect(collision).toContain('visit_key =')
    expect(script).toContain('eventInvitationAttributions: seed.userInfluence.eventInvitationAttributions.length')
    expect(script).toContain('eventHearts: seed.userInfluence.eventHearts.length')
    expect(script).toContain('profileVisits: seed.userInfluence.profileVisits.length')
  })
})
