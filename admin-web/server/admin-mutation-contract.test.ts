import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADMIN_WEB_OPERATION_CONTRACT } from '@mip/admin-contracts'
import { ADMIN_EVENT_MUTATION_ACTIONS } from '../src/modules/admin-event-mutation-forms.ts'
import { ADMIN_PEOPLE_MUTATION_ACTIONS } from '../src/modules/admin-people-mutation-forms.ts'
import { ADMIN_CONTENT_MUTATION_ACTIONS } from '../src/modules/content-mutation-forms.ts'
import { ADMIN_TASK_MUTATION_ACTIONS } from '../src/modules/admin-task-management.ts'
import { ADMIN_BANNER_MUTATION_ACTIONS } from '../src/modules/admin-banner-management.ts'
import { ADMIN_GAME_MUTATION_ACTIONS } from '../src/modules/admin-game-management.ts'
import {
  REVIEWED_ADMIN_MUTATIONS,
  REVIEWED_ADMIN_MUTATION_ACTIONS,
  WEB_ADMIN_QUERY_ACTIONS,
} from './admin-mutation-contract.ts'

describe('reviewed Web admin mutation contract', () => {
  it('derives query actions and mutation fields from the generated server contract', () => {
    const expectedQueries = ADMIN_WEB_OPERATION_CONTRACT.operations
      .filter(operation => operation.webAllowed
        && operation.webRoute === 'ADMIN'
        && operation.kind === 'QUERY')
      .map(operation => operation.action)
    const expectedMutations = ADMIN_WEB_OPERATION_CONTRACT.operations
      .filter(operation => operation.webAllowed
        && operation.webRoute === 'ADMIN'
        && operation.kind === 'MUTATION')
      .map(operation => ({
        action: operation.action,
        required: operation.requiredInputKeys,
        optional: operation.optionalInputKeys,
      }))

    assert.deepEqual([...WEB_ADMIN_QUERY_ACTIONS], expectedQueries)
    assert.deepEqual(REVIEWED_ADMIN_MUTATIONS, expectedMutations)
  })

  it('covers every rendered advanced operation exactly once', () => {
    const advanced = [
      ...ADMIN_PEOPLE_MUTATION_ACTIONS,
      ...ADMIN_EVENT_MUTATION_ACTIONS,
      ...ADMIN_CONTENT_MUTATION_ACTIONS,
      ...ADMIN_TASK_MUTATION_ACTIONS,
      ...ADMIN_BANNER_MUTATION_ACTIONS,
      ...ADMIN_GAME_MUTATION_ACTIONS,
    ]
    assert.equal(new Set(advanced).size, advanced.length)
    for (const action of advanced) assert.equal(REVIEWED_ADMIN_MUTATION_ACTIONS.has(action), true, action)
  })

  it('has disjoint required and optional keys for every action', () => {
    assert.equal(new Set(REVIEWED_ADMIN_MUTATIONS.map(item => item.action)).size, REVIEWED_ADMIN_MUTATIONS.length)
    for (const item of REVIEWED_ADMIN_MUTATIONS) {
      assert.equal(item.required.length > 0, true, item.action)
      assert.equal(new Set([...item.required, ...item.optional]).size, item.required.length + item.optional.length, item.action)
    }
  })

  it('exposes only the reviewed export ticket lifecycle fields', () => {
    const exports = REVIEWED_ADMIN_MUTATIONS.filter(item => item.action.startsWith('mip.admin.exports.'))
    assert.deepEqual(exports, [
      { action: 'mip.admin.exports.create', required: ['exportType', 'includesPhone', 'filters'], optional: [] },
      { action: 'mip.admin.exports.prepare', required: ['ticketId', 'token'], optional: [] },
      { action: 'mip.admin.exports.reserve', required: ['ticketId', 'token'], optional: [] },
      { action: 'mip.admin.exports.complete', required: ['ticketId', 'token'], optional: [] },
    ])
  })
})
