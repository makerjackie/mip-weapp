import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP event feedback answers migration', () => {
  it('adds a nullable compatibility column while locking the migration checksums', () => {
    const migrationPath = 'database/mysql/mip/060_event_feedback_answers.sql'
    const rollbackPath = 'database/mysql/mip/rollback/060_event_feedback_answers.sql'
    const migration = read(migrationPath)
    const rollback = read(rollbackPath)
    const lock = JSON.parse(read('database/mysql/mip/migrations.lock.json')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.version === '20260903600000')
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

    expect(migration).toContain('ALTER TABLE mip_event_feedback')
    expect(migration).toContain('ADD COLUMN answers_json JSON NULL')
    expect(rollback).toContain('DROP COLUMN answers_json')
    expect(entry).toEqual({
      version: '20260903600000',
      name: 'event_feedback_answers',
      sql: migrationPath,
      sqlSha256: sha256(migration),
      rollback: rollbackPath,
      rollbackSha256: sha256(rollback),
      createsTables: [],
      altersTables: ['mip_event_feedback'],
    })
  })
})
