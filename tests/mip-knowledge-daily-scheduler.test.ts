import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP knowledge daily scheduler contract', () => {
  it('locks one append-only schedule migration without executing or weakening rollback safety', () => {
    const migration = read('database/mysql/mip/043_knowledge_daily_ingestion.sql')
    const rollback = read('database/mysql/mip/rollback/043_knowledge_daily_ingestion.sql')
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.name === 'mip_knowledge_daily_ingestion')
    expect(entry).toMatchObject({
      altersTables: [],
      createsTables: ['mip_knowledge_ingestion_schedules'],
      rollback: 'database/mysql/mip/rollback/043_knowledge_daily_ingestion.sql',
      sql: 'database/mysql/mip/043_knowledge_daily_ingestion.sql',
      version: '20260826430000',
    })
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
    expect(migration).toContain('mip_knowledge_ingestion_schedules')
    expect(migration).toContain('attempt_count BETWEEN 0 AND 3')
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i)
    expect(rollback).toContain('SELECT 1 FROM mip_knowledge_ingestion_schedules LIMIT 1')
    expect(RUNTIME_TABLE_PRIVILEGES.mip_knowledge_ingestion_schedules)
      .toEqual(['SELECT', 'INSERT', 'UPDATE'])
  })

  it('keeps MySQL and VPC out of the scheduler while retaining one signed rolling timer', () => {
    const scheduler = [
      read('cloudfunctions/mip-knowledge-scheduler/index.js'),
      read('cloudfunctions/mip-knowledge-scheduler/lib/config.js'),
      read('cloudfunctions/mip-knowledge-scheduler/lib/trigger-controller.js'),
    ].join('\n')
    expect(scheduler).toContain('single-rolling-one-shot')
    expect(scheduler).toContain('mip-knowledge-ingestion-next')
    expect(scheduler).toContain('MIP_KNOWLEDGE_SCHEDULER_HMAC_SECRET')
    expect(scheduler).not.toContain('MIP_DB_CONNECTION_URI')
    expect(scheduler).not.toContain('mysql2')
    expect(read('cloudfunctions/mip-knowledge-scheduler/config.json')).not.toMatch(/vpc|timer|cron/i)
  })

  it('forces worker-created content through the existing review boundary', () => {
    const repository = read('cloudfunctions/mip-admin-api/domain/knowledge-scheduling-repository.js')
    const service = read('cloudfunctions/mip-admin-api/domain/knowledge-scheduling-service.js')
    expect(repository).toContain('\'WORKER\', \'RUNNING\'')
    expect(repository).toContain('\'HOT_NEWS\'')
    expect(repository).toContain('\'FREE\'')
    expect(repository).toContain('\'PENDING_REVIEW\', \'PENDING\'')
    expect(repository).toContain('LIMIT ? FOR UPDATE SKIP LOCKED')
    expect(service).toContain('MAX_SOURCES_PER_RUN')
    expect(repository).toContain('MAX_SOURCE_ATTEMPTS = 3')
    expect(repository).toContain('CAPABILITIES.KNOWLEDGE_MANAGE')
  })

  it('publishes two neutral schedule actions and two registry-external HMAC actions', () => {
    const operations = read('cloudfunctions/mip-admin-api/domain/operations/knowledge.js')
    const index = read('cloudfunctions/mip-admin-api/index.js')
    const auth = read('cloudfunctions/mip-admin-api/lib/knowledge-scheduler-auth.js')
    expect(operations).toContain('mip.admin.knowledge.schedules.list')
    expect(operations).toContain('mip.admin.knowledge.schedules.save')
    expect(auth).toContain('getKnowledgeIngestionWakePlan')
    expect(auth).toContain('runDueKnowledgeIngestionSchedules')
    expect(index).toContain('KNOWLEDGE_SCHEDULE_AUTOMATION_UNVERIFIED')
  })
})
