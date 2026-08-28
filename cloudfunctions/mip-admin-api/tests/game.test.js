'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminGame } = require('../domain/game')

const caller = { appId: 'wx-browser-value', identityKey: 'untrusted-browser-value' }

function accessWith(bindings) {
  return {
    async session(received) {
      assert.equal(received, caller)
      return {
        caller: {
          appId: 'wx-server-app',
          userId: '10000000-0000-4000-8000-000000000001',
        },
        bindings,
      }
    },
  }
}

describe('admin Game adapter authorization', () => {
  it('rechecks platform game.manage and forwards only resolved identity', async () => {
    const calls = []
    const adapter = createAdminGame({
      access: accessWith([{
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['game.manage'],
      }]),
      client: { async execute(input) { calls.push(input); return { items: [] } } },
    })
    const result = await adapter.listGameTeams(caller, { seasonId: 'season-a' })

    assert.deepEqual(result, { items: [] })
    assert.deepEqual(calls, [{
      appId: 'wx-server-app',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      action: 'mip.admin.game.teams.list',
      input: { seasonId: 'season-a' },
    }])
  })

  it('rejects a branch grant or missing capability before invoking Game service', async () => {
    for (const binding of [
      {
        roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: 'branch-a',
        capabilities: ['game.manage'],
      },
      {
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['events.read'],
      },
    ]) {
      let invoked = false
      const adapter = createAdminGame({
        access: accessWith([binding]),
        client: { async execute() { invoked = true } },
      })
      await assert.rejects(
        () => adapter.finalizeGameWeeklyMatch(caller, { matchId: 'match-a', expectedVersion: 1 }),
        error => error.code === 'FORBIDDEN' && error.message === 'FORBIDDEN',
      )
      assert.equal(invoked, false)
    }
  })

  it('separates the mutation key from the typed business input', async () => {
    const calls = []
    const adapter = createAdminGame({
      access: accessWith([{
        roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null,
        capabilities: ['game.manage'],
      }]),
      client: { async execute(input) { calls.push(input); return { idempotent: false } } },
    })
    const result = await adapter.finalizeGameWeeklyMatch(caller, {
      matchId: 'match-a',
      expectedVersion: 1,
      idempotencyKey: 'game-finalize-match-0001',
    })

    assert.deepEqual(result, { idempotent: false })
    assert.deepEqual(calls, [{
      appId: 'wx-server-app',
      actorUserId: '10000000-0000-4000-8000-000000000001',
      action: 'mip.admin.game.matches.finalize',
      input: { matchId: 'match-a', expectedVersion: 1 },
      idempotencyKey: 'game-finalize-match-0001',
    }])
  })
})
