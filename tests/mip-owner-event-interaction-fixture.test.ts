import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildOwnerInteractionInsertQuery,
  buildOwnerInteractionPreflightQuery,
  buildOwnerInteractionVerificationQuery,
  OWNER_INTERACTION_EVENT_ID,
  OWNER_INTERACTION_EVENT_TITLE,
  OWNER_INTERACTION_REGISTRATION_ID,
  ownerInteractionFixtureSummary,
  resolveOwnerInteractionFixtureCommand,
} from '../scripts/lib/mip-owner-event-interaction-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..')
const appId = 'wx1111111111111111'
const ownerUserId = '70000000-0000-4000-8000-000000000001'

describe('Owner event interaction fixture', () => {
  it('requires exact development/test environment and explicit confirmations', () => {
    const env = {
      CLOUDBASE_ENV_ID: 'mip-development',
      MINI_PROGRAM_APP_ID: appId,
      MIP_ALLOWED_APP_IDS: appId,
      MIP_DEPLOYMENT_STAGE: 'development',
      MIP_CATALOG_STAGE: 'TEST',
      MIP_PAYMENT_MODE: 'disabled',
    }
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: ['--confirm-env=mip-development', `--confirm-app-id=${appId}`],
      env,
    })).toThrow('confirmation flag')
    expect(resolveOwnerInteractionFixtureCommand({
      args: [
        '--confirm-env=mip-development',
        `--confirm-app-id=${appId}`,
        '--confirm-owner-event-interaction',
      ],
      env,
    })).toMatchObject({ envId: 'mip-development', appId, stage: 'development' })
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: ['--confirm-env=mip-production', `--confirm-app-id=${appId}`, '--confirm-owner-event-interaction'],
      env,
    })).toThrow('exact environment')
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [`--confirm-env=mip-development`, `--confirm-app-id=${appId}`, '--confirm-owner-event-interaction'],
      env: { ...env, MIP_DEPLOYMENT_STAGE: 'production' },
    })).toThrow('restricted to development/test')
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [
        '--confirm-env=mip-development',
        `--confirm-app-id=${appId}`,
        '--confirm-owner-event-interaction',
        '--confirm-staging-demo',
      ],
      env,
    })).toThrow('staging requires')
  })

  it('allows staging only with the exact staging confirmation', () => {
    const env = {
      CLOUDBASE_ENV_ID: 'mip-staging',
      MINI_PROGRAM_APP_ID: appId,
      MIP_ALLOWED_APP_IDS: appId,
      MIP_DEPLOYMENT_STAGE: 'staging',
      MIP_CATALOG_STAGE: 'TEST',
      MIP_PAYMENT_MODE: 'disabled',
    }
    const baseArgs = [
      '--confirm-env=mip-staging',
      `--confirm-app-id=${appId}`,
      '--confirm-owner-event-interaction',
    ]
    expect(() => resolveOwnerInteractionFixtureCommand({ args: baseArgs, env })).toThrow('--confirm-staging-demo')
    expect(resolveOwnerInteractionFixtureCommand({
      args: [...baseArgs, '--confirm-staging-demo'],
      env,
    })).toMatchObject({ stage: 'staging', stagingConfirmed: true })
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [...baseArgs, '--confirm-staging-demo', '--confirm-staging-demo'],
      env,
    })).toThrow('--confirm-staging-demo')
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [...baseArgs, '--confirm-staging-demo'],
      env: { ...env, MIP_CATALOG_STAGE: 'LIVE' },
    })).toThrow('TEST catalog')
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [...baseArgs, '--confirm-staging-demo'],
      env: { ...env, MIP_PAYMENT_MODE: 'live' },
    })).toThrow('non-live payment')
    expect(() => resolveOwnerInteractionFixtureCommand({
      args: [...baseArgs, '--confirm-staging-demo'],
      env: { ...env, MIP_DEPLOYMENT_STAGE: 'production' },
    })).toThrow('restricted to development/test')
  })

  it('requires the exact ended free event in a READY demo manifest and unused registration identities', () => {
    const query = buildOwnerInteractionPreflightQuery({
      appId,
      eventId: OWNER_INTERACTION_EVENT_ID,
      registrationId: OWNER_INTERACTION_REGISTRATION_ID,
      ownerUserId,
    })
    expect(query).toContain('eventCrossApp')
    expect(query).toContain('eventReadyRows')
    expect(query).toContain(`event.status = 'ENDED'`)
    expect(query).toContain(`event.access_type = 'FREE'`)
    expect(query).toContain('event.ends_at < UTC_TIMESTAMP(3)')
    expect(query).toContain(`BINARY event.title = BINARY '${OWNER_INTERACTION_EVENT_TITLE}'`)
    expect(query).toContain(`demo_manifest.setting_key = 'demo_seed_manifest'`)
    expect(query).toContain(`JSON_EXTRACT(demo_manifest.value_json, '$.state')`)
    expect(query).toContain(`= 'READY'`)
    expect(query).toContain(`JSON_EXTRACT(demo_manifest.value_json, '$.recordsByTable.mip_events')`)
    expect(query).toContain('ownerEventRows')
    expect(query).toContain(`app_id <> '${appId}'`)
    expect(query).toContain(`id = '${OWNER_INTERACTION_REGISTRATION_ID}'`)
    expect(query).toContain(`user_id = '${ownerUserId}'`)
    expect(query).not.toContain(`id = '${OWNER_INTERACTION_REGISTRATION_ID}' AND app_id`)
  })

  it('writes only a fixed ATTENDED registration without an upsert overwrite', () => {
    const query = buildOwnerInteractionInsertQuery({
      appId,
      eventId: OWNER_INTERACTION_EVENT_ID,
      registrationId: OWNER_INTERACTION_REGISTRATION_ID,
      ownerUserId,
    })
    expect(query).toContain('INSERT INTO mip_event_registrations')
    expect(query).toContain('\'ATTENDED\'')
    expect(query).toContain(`'${OWNER_INTERACTION_REGISTRATION_ID}'`)
    expect(query).toContain(`'${ownerUserId}'`)
    expect(query).not.toContain('ON DUPLICATE KEY UPDATE')
    expect(query).not.toContain('UPDATE mip_event_registrations')
    expect(query.match(/INSERT INTO/g)).toHaveLength(1)
    expect(query).not.toContain('mip_event_checkins')
    expect(query).not.toContain('mip_event_checkin_transitions')
    expect(query).not.toContain('mip_outbox_events')
    expect(query).not.toContain('mip_audit_logs')
  })

  it('verifies the exact owner registration and returns an identity-free summary', () => {
    const query = buildOwnerInteractionVerificationQuery({
      appId,
      eventId: OWNER_INTERACTION_EVENT_ID,
      registrationId: OWNER_INTERACTION_REGISTRATION_ID,
      ownerUserId,
    })
    expect(query).toContain('status = \'ATTENDED\'')
    expect(query).toContain('version >= 2')
    expect(ownerInteractionFixtureSummary({ ready: 1 })).toEqual({
      ready: true,
      registrationStatus: 'ATTENDED',
      interactionPage: 'packages/member/mip-events/interaction/index',
    })
    expect(() => ownerInteractionFixtureSummary({ ready: 0 })).toThrow('verification failed')
    expect(JSON.stringify(ownerInteractionFixtureSummary({ ready: 1 }))).not.toContain(appId)
    expect(JSON.stringify(ownerInteractionFixtureSummary({ ready: 1 }))).not.toContain(ownerUserId)
  })

  it('keeps the operator script and package entrypoint separate from seed.demo.json', () => {
    const script = fs.readFileSync(path.join(root, 'scripts/seed-owner-event-interaction.mjs'), 'utf8')
    const helper = fs.readFileSync(path.join(root, 'scripts/lib/mip-owner-event-interaction-fixture.mjs'), 'utf8')
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(script).toContain('buildOwnerCandidateQuery')
    expect(script).toContain('selectOwnerCandidateId')
    expect(script).toContain('MIP_OWNER_PHONE')
    expect(helper).toContain('--confirm-owner-event-interaction')
    expect(script).toContain('--validate-only')
    expect(script.match(/manageMysqlDatabase/g)).toHaveLength(1)
    expect(packageJson.scripts['event:interaction:seed']).toBe('node scripts/seed-owner-event-interaction.mjs')
    expect(script).toContain('seed.demo.json')
    expect(script).not.toContain('writeFileSync(path.join(root, \'database\'')
  })
})
