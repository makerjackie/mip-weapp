import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildOwnerShowcaseBadgeEquipmentInsert,
  buildOwnerShowcaseBadgeInsert,
  buildOwnerShowcaseBadgeProfileInsert,
  buildOwnerShowcaseEventOrderInsert,
  buildOwnerShowcasePreflightQuery,
  buildOwnerShowcaseRegistrationInsert,
  buildOwnerShowcaseStateQuery,
  buildOwnerShowcaseTaskAssignmentInsert,
  OWNER_SHOWCASE_BADGES,
  OWNER_SHOWCASE_EVENTS,
  OWNER_SHOWCASE_TASK_ASSIGNMENTS,
  ownerShowcaseFixtureSummary,
  resolveOwnerShowcaseCommand,
} from '../scripts/lib/mip-owner-showcase-fixture.mjs'

const appId = 'wx1234567890abcdef'
const ownerUserId = '70000000-0000-4000-8000-000000000001'

describe('owner showcase fixture safety', () => {
  it('requires exact TEST-only confirmations and development stage', () => {
    const config = resolveOwnerShowcaseCommand({
      args: [`--confirm-env=dev-env`, `--confirm-app-id=${appId}`, '--confirm-owner-showcase'],
      env: {
        CLOUDBASE_ENV_ID: 'dev-env',
        MINI_PROGRAM_APP_ID: appId,
        MIP_DEPLOYMENT_STAGE: 'development',
        MIP_CATALOG_STAGE: 'TEST',
        MIP_PAYMENT_MODE: 'disabled',
        MIP_ALLOWED_APP_IDS: appId,
      },
    })
    expect(config.paymentMode).toBe('disabled')
    expect(() => resolveOwnerShowcaseCommand({
      args: [`--confirm-env=prod-env`, `--confirm-app-id=${appId}`, '--confirm-owner-showcase'],
      env: { CLOUDBASE_ENV_ID: 'prod-env', MINI_PROGRAM_APP_ID: appId, MIP_DEPLOYMENT_STAGE: 'production' },
    })).toThrow(/development\/test/)
  })

  it('only emits the fixed events and badges', () => {
    expect(OWNER_SHOWCASE_EVENTS).toHaveLength(2)
    expect(OWNER_SHOWCASE_BADGES).toHaveLength(3)
    expect(OWNER_SHOWCASE_TASK_ASSIGNMENTS).toHaveLength(2)
    expect(buildOwnerShowcaseRegistrationInsert({ appId, ownerUserId, ...OWNER_SHOWCASE_EVENTS[0] })).toContain('\'REGISTERED\'')
    expect(buildOwnerShowcaseEventOrderInsert({ appId, ownerUserId })).toContain('\'EVENT\'')
    expect(buildOwnerShowcaseEventOrderInsert({ appId, ownerUserId })).toContain('"catalogStage":"TEST"')
    expect(buildOwnerShowcaseBadgeInsert({ appId, ownerUserId, badge: OWNER_SHOWCASE_BADGES[0] })).toContain('TEST 演示夹具')
    expect(buildOwnerShowcaseBadgeProfileInsert({ appId, ownerUserId })).toContain('mip_user_badge_profiles')
    expect(buildOwnerShowcaseBadgeEquipmentInsert({ appId, ownerUserId, badge: OWNER_SHOWCASE_BADGES[0] })).toContain('slot_no')
    expect(buildOwnerShowcaseTaskAssignmentInsert({ appId, ownerUserId, assignment: OWNER_SHOWCASE_TASK_ASSIGNMENTS[0] })).toContain('mip_task_assignments')
    expect(() => buildOwnerShowcaseRegistrationInsert({
      appId,
      ownerUserId,
      eventId: '60000000-0000-4000-8000-000000000099',
      registrationId: OWNER_SHOWCASE_EVENTS[0].registrationId,
    })).toThrow(/allowlist/)
  })

  it('scopes preflight and verification by app and owner', () => {
    const preflight = buildOwnerShowcasePreflightQuery({ appId, ownerUserId })
    const state = buildOwnerShowcaseStateQuery({ appId, ownerUserId })
    expect(preflight).toContain(`app_id = '${appId}'`)
    expect(preflight).toContain(`user_id = '${ownerUserId}'`)
    expect(preflight).toContain('app_id <>')
    expect(state).toContain('status = \'REGISTERED\'')
    expect(state).toContain('status = \'ACTIVE\'')
  })

  it('requires all showcase facts to verify', () => {
    expect(ownerShowcaseFixtureSummary({ registeredEvents: 3, paidEventOrders: 1, activeBadges: 3, equippedBadges: 3, assignedTasks: 2, wrote: 10 })).toMatchObject({ ready: true, wrote: 10 })
    expect(() => ownerShowcaseFixtureSummary({ registeredEvents: 1, paidEventOrders: 1, activeBadges: 3, equippedBadges: 3, assignedTasks: 2 })).toThrow(/verification failed/)
  })

  it('keeps the runner separate from the demo seed', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/seed-owner-showcase.mjs'), 'utf8')
    expect(script).toContain('seed.demo.json')
    expect(script).toContain('\'mip_orders\'')
    expect(script).not.toContain('seed-demo.mjs')
  })
})
