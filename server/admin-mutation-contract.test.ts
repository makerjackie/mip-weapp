import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADMIN_EVENT_MUTATION_ACTIONS } from '../src/modules/admin-event-mutation-forms.ts'
import { ADMIN_PEOPLE_MUTATION_ACTIONS } from '../src/modules/admin-people-mutation-forms.ts'
import { ADMIN_CONTENT_MUTATION_ACTIONS } from '../src/modules/content-mutation-forms.ts'
import { ADMIN_TASK_MUTATION_ACTIONS } from '../src/modules/admin-task-management.ts'
import {
  REVIEWED_ADMIN_MUTATIONS,
  REVIEWED_ADMIN_MUTATION_ACTIONS,
} from './admin-mutation-contract.ts'

describe('reviewed Web admin mutation contract', () => {
  it('covers every rendered advanced operation exactly once', () => {
    const advanced = [
      ...ADMIN_PEOPLE_MUTATION_ACTIONS,
      ...ADMIN_EVENT_MUTATION_ACTIONS,
      ...ADMIN_CONTENT_MUTATION_ACTIONS,
      ...ADMIN_TASK_MUTATION_ACTIONS,
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
})
