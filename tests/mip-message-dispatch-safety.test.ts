import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('message dispatch and delivery safety', () => {
  it('locks an app-scoped dispatch state machine and a campaign-owned active pointer', () => {
    const migration = read('database/mysql/mip/040_message_dispatch_safety.sql')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_message_campaign_dispatches')
    expect(migration).toContain('status IN (\'SCHEDULED\', \'PROCESSING\', \'COMPLETED\', \'FAILED\', \'CANCELLED\')')
    expect(migration).toContain('last_outcome IN (\'NOT_ATTEMPTED\', \'SUCCEEDED\', \'KNOWN_FAILED\', \'UNKNOWN\')')
    expect(migration).toContain('retry_disposition IN (\'RETRIABLE\', \'TERMINAL\', \'MANUAL_REVIEW\')')
    expect(migration).toContain('mip_message_campaign_dispatches_attempts_ck CHECK (attempts <= 5)')
    expect(migration).toContain(
      'app_id, status, retry_disposition, available_at, scheduled_for, lease_expires_at, id',
    )
    expect(migration).toContain('UNIQUE KEY mip_message_campaign_dispatches_request_uk')
    expect(migration).toContain('FOREIGN KEY (app_id, scheduled_by_user_id)')
    expect(migration).toContain('FOREIGN KEY (app_id, cancelled_by_user_id)')
    expect(migration).toContain('mip_message_campaign_dispatches_canceller_idx (app_id, cancelled_by_user_id)')
    expect(migration).toContain('UNIQUE KEY mip_message_campaigns_active_dispatch_uk (app_id, active_dispatch_id)')
    expect(migration).toContain('mip_message_campaigns_active_dispatch_fk_idx (app_id, id, active_dispatch_id)')
    expect(migration).toContain('FOREIGN KEY (\n    app_id, id, active_dispatch_id\n  )')
    expect(migration).toContain('active_dispatch_id IS NULL OR status = \'READY\'')
    expect(migration).toContain('last_outcome = \'SUCCEEDED\' AND retry_disposition = \'TERMINAL\'')
  })

  it('backfills old delivery facts conservatively and prevents unsafe automatic replay', () => {
    const migration = read('database/mysql/mip/040_message_dispatch_safety.sql')
    const repository = read('cloudfunctions/mip-notification-worker/domain/repository.js')
    expect(migration).toContain('WHEN \'PENDING\' THEN \'NOT_ATTEMPTED\'')
    expect(migration).toContain('WHEN \'DELIVERED\' THEN \'SUCCEEDED\'')
    expect(migration).toContain('ELSE \'UNKNOWN\'')
    expect(migration).toContain('WHEN \'PENDING\' THEN \'RETRIABLE\'')
    expect(migration).toContain('WHEN \'DELIVERED\' THEN \'TERMINAL\'')
    expect(migration).toContain('ELSE \'MANUAL_REVIEW\'')
    expect(migration).toContain('mip_delivery_tasks_attempts_ck CHECK (attempts <= 5)')

    const retrySelection = repository.slice(
      repository.indexOf('(status = \'PENDING\' AND last_outcome'),
      repository.indexOf('ORDER BY available_at, id LIMIT', repository.indexOf('(status = \'PENDING\'')),
    )
    expect(retrySelection).toContain('status = \'FAILED\'')
    expect(retrySelection).toContain('last_outcome IN (\'NOT_ATTEMPTED\', \'KNOWN_FAILED\')')
    expect(retrySelection).toContain('retry_disposition = \'RETRIABLE\'')
    expect(retrySelection).not.toContain('status = \'PROCESSING\'')
    expect(repository).toContain('last_outcome = \'UNKNOWN\', retry_disposition = \'MANUAL_REVIEW\'')
    expect(repository).toContain('last_outcome = \'SUCCEEDED\'')
    expect(repository).toContain('outcome: \'KNOWN_FAILED\'')
  })

  it('keeps rollback and runtime privileges conservative and checksum locked', () => {
    const migration = read('database/mysql/mip/040_message_dispatch_safety.sql')
    const rollback = read('database/mysql/mip/rollback/040_message_dispatch_safety.sql')
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.name === 'mip_message_dispatch_safety')
    expect(rollback).toContain('SELECT 1 FROM mip_message_campaign_dispatches LIMIT 1')
    expect(rollback).toContain('Delivery outcomes are safety evidence')
    expect(rollback).toContain('SELECT 1 FROM mip_delivery_tasks LIMIT 1')
    expect(rollback.indexOf('SELECT 1 FROM mip_delivery_tasks LIMIT 1'))
      .toBeLessThan(rollback.indexOf('DROP COLUMN last_outcome'))
    expect(RUNTIME_TABLE_PRIVILEGES.mip_message_campaign_dispatches)
      .toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_message_campaign_dispatches).not.toContain('DELETE')
    expect(entry?.createsTables).toEqual(['mip_message_campaign_dispatches'])
    expect(entry?.altersTables).toEqual(['mip_message_campaigns', 'mip_delivery_tasks'])
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
  })

  it('revalidates campaign publication before projecting and converges withdrawals without deletion', () => {
    const projector = read('cloudfunctions/mip-outbox-worker/domain/projector.js')
    expect(projector).toContain('LEFT JOIN mip_message_campaigns campaign')
    expect(projector).toContain('campaign.id = message.publication_id')
    expect(projector).toContain('row.campaign_status !== \'PUBLISHED\'')
    expect(projector).toContain('\'CAMPAIGN_WITHDRAWN\'')
    expect(projector).not.toMatch(/DELETE\s+FROM\s+mip_inbox_messages/i)
  })
})
