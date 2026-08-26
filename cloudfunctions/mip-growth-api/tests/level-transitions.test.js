'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { appendLevelTransition } = require('../domain/level-transitions')

test('appends one immutable transition when the effective level changes', async () => {
  const calls = []
  const id = 'transition-id'
  const tx = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('FROM mip_growth_levels')) {
        return [
          { id: 'level-2', level_key: 'active', name: '活跃', minimum_experience: 100 },
          { id: 'level-1', level_key: 'starter', name: '起步', minimum_experience: 0 },
        ]
      }
      return { affectedRows: 1 }
    },
  }
  const result = await appendLevelTransition(tx, {
    createId: () => id,
    appId: 'app-id',
    userId: 'user-id',
    sourceEventId: 'event-id',
    sourceEventType: 'task.completed',
    experienceBefore: 90,
    experienceAfter: 110,
  })
  assert.equal(result, id)
  assert.equal(calls.length, 2)
  assert.match(calls[1].sql, /mip_growth_level_transitions/)
  assert.deepEqual(calls[1].params.slice(0, 9), [
    id, 'app-id', 'user-id', 'level-1', 'starter', '起步', 'level-2', 'active', '活跃',
  ])
})

test('does not append when the effective level is unchanged', async () => {
  let writes = 0
  const tx = {
    async query(sql) {
      if (sql.includes('FROM mip_growth_levels')) {
        return [{ id: 'level-1', level_key: 'starter', name: '起步', minimum_experience: 0 }]
      }
      writes += 1
      return { affectedRows: 1 }
    },
  }
  assert.equal(await appendLevelTransition(tx, {
    createId: () => 'unused', appId: 'app-id', userId: 'user-id',
    sourceEventId: 'event-id', sourceEventType: 'task.completed',
    experienceBefore: 10, experienceAfter: 20,
  }), null)
  assert.equal(writes, 0)
})
