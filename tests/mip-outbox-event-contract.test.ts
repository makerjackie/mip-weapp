import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIP_FUNCTION_SOURCES } from '../scripts/lib/mip-function-names.mjs'
import { verifyOutboxEventContract } from '../scripts/lib/mip-outbox-event-contract.mjs'

function verifyFixture(producer: string) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-outbox-contract-'))
  const sourceRoots = ['cloudfunctions/producer', 'cloudfunctions/mip-outbox-worker']
  try {
    const files = {
      'cloudfunctions/producer/producer.js': producer,
      'cloudfunctions/mip-outbox-worker/domain/projector.js': `
        const NO_PROJECTION_EVENT_TYPES = new Set(['known.event', 'another.event'])
        function projectEvent(database, event) {
          switch (event.event_type) { case 'projected.event': return true }
        }
      `,
    }
    for (const [relative, source] of Object.entries(files)) {
      const target = path.join(cwd, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, source)
    }
    return verifyOutboxEventContract({ cwd, sourceRoots }).producerEventTypes
  }
  finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

const genericWriter = `
  async function writeOutbox(tx, event) {
    await tx.query('INSERT INTO mip_outbox_events (event_type, payload_json) VALUES (?, ?)',
      [event.eventType, JSON.stringify(event.payload)])
  }
`
const knownProducer = `
  async function known(tx) {
    await tx.query("INSERT INTO mip_outbox_events (event_type) VALUES ('known.event')")
  }
`

describe('outbox producer enumeration', () => {
  it('resolves the repository producers against the real projector', () => {
    const result = verifyOutboxEventContract({
      cwd: path.resolve(import.meta.dirname, '..'),
      sourceRoots: [...new Set(Object.values(MIP_FUNCTION_SOURCES))].map(name => `cloudfunctions/${name}`),
    })
    expect(result.producerEventTypes).toContain('event.registration_refund_requested')
    expect(result.producerEventTypes).toContain('task.unpublished')
    expect(result.producerEventTypes).toContain('operations.notification_published')
  })

  it('binds only the event_type column and ignores payload strings and question marks', () => {
    expect(verifyFixture(`
      async function produce(tx) {
        await tx.query("INSERT INTO mip_outbox_events (payload_json, event_type) VALUES (JSON_OBJECT('key', 'ordinary.value?'), ?)",
          ['known.event'])
        await tx.query('INSERT INTO mip_outbox_events (payload_json, event_type) VALUES (?, ?)',
          [JSON.stringify({ label: 'ordinary.value', eventType: 'payload.event' }), 'another.event'])
      }
    `)).toEqual(['another.event', 'known.event'])
  })

  it('enumerates all branches of an explicit writer eventType without walking its payload', () => {
    expect(verifyFixture(`${genericWriter}
      async function produce(tx, flag) {
        const event = { eventType: flag ? 'known.event' : 'another.event', payload: { eventType: 'payload.event' } }
        await writeOutbox(tx, event)
      }
    `)).toEqual(['another.event', 'known.event'])
  })

  it.each([
    'flag ? \'known.event\' : runtimeValue',
    'flag ? runtimeValue : \'known.event\'',
    'flag ? \'known.event\' : (other ? \'another.event\' : runtimeValue)',
  ])('rejects partially dynamic eventType expressions: %s', (expression) => {
    expect(() => verifyFixture(`${genericWriter}
      async function produce(tx, flag, other, runtimeValue) {
        await writeOutbox(tx, { eventType: ${expression} })
      }
    `)).toThrow(/must be statically enumerable/)
  })

  it('rejects a mixed dynamic branch in a direct SQL binding', () => {
    expect(() => verifyFixture(`
      async function produce(tx, flag, runtimeValue) {
        await tx.query('INSERT INTO mip_outbox_events (event_type) VALUES (?)',
          [flag ? 'known.event' : runtimeValue])
      }
    `)).toThrow(/must be statically enumerable/)
  })

  it('finds unsupported events through const SQL aliases even when another producer is valid', () => {
    expect(() => verifyFixture(`${knownProducer}
      async function bad(tx) {
        const sql = "INSERT INTO mip_outbox_events (event_type) VALUES ('unsupported.event')"
        const alias = sql
        await tx.query(alias)
      }
    `)).toThrow(/not classified by projector: unsupported.event/)
  })

  it('resolves SQL and bound parameter aliases in lexical scope', () => {
    expect(verifyFixture(`
      const eventType = 'unsupported.event'
      async function produce(tx) {
        const eventType = 'known.event'
        const sql = 'INSERT INTO mip_outbox_events (event_type) VALUES (?)'
        const params = [eventType]
        await tx.query(sql, params)
      }
    `)).toEqual(['known.event'])
  })

  it('rejects mutable SQL aliases instead of silently skipping their inserts', () => {
    expect(() => verifyFixture(`${knownProducer}
      async function bad(tx) {
        let sql = "INSERT INTO mip_outbox_events (event_type) VALUES ('unsupported.event')"
        await tx.query(sql)
      }
    `)).toThrow(/Outbox SQL must be statically enumerable/)
  })

  it('supports constant bulk VALUES tuples without using unrelated SQL literals', () => {
    expect(verifyFixture(`
      async function produce(tx, rows) {
        const values = rows.map(() => "('ordinary.value', 'known.event', JSON_OBJECT('key', '?'))").join(', ')
        await tx.query(\`INSERT INTO mip_outbox_events (aggregate_type, event_type, payload_json) VALUES \${values}\`)
      }
    `)).toEqual(['known.event'])
  })

  it('rejects unknown bulk VALUES rather than inferring events from incidental literals', () => {
    expect(() => verifyFixture(`${knownProducer}
      async function bad(tx, rows, runtimeValue) {
        const values = rows.map(() => runtimeValue).join(', ')
        await tx.query(\`INSERT INTO mip_outbox_events (event_type) VALUES \${values}\`)
      }
    `)).toThrow(/Outbox SQL must be statically enumerable/)
  })

  it('checks every event_type in a multi-row insert', () => {
    expect(() => verifyFixture(`
      async function produce(tx) {
        await tx.query("INSERT INTO mip_outbox_events (event_type, payload_json) VALUES (?, '{}'), (?, '{}')",
          ['known.event', 'unsupported.event'])
      }
    `)).toThrow(/not classified by projector: unsupported.event/)
  })

  it('supports positional and destructured eventType writer parameters', () => {
    expect(verifyFixture(`
      async function appendOutbox(tx, eventType) {
        await tx.query('INSERT INTO mip_outbox_events (event_type) VALUES (?)', [eventType])
      }
      async function writeOutbox(tx, { eventType }) {
        await tx.query('INSERT INTO mip_outbox_events (event_type) VALUES (?)', [eventType])
      }
      async function produce(tx) {
        await appendOutbox(tx, 'known.event')
        await writeOutbox(tx, { eventType: 'another.event' })
      }
    `)).toEqual(['another.event', 'known.event'])
  })
})
