import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

interface OperationDefinition {
  action: string
  kind: 'QUERY' | 'MUTATION'
}

const require = createRequire(import.meta.url)
const catalog = require('../cloudfunctions/mip-admin-api/domain/operation-catalog') as {
  healthOperation: OperationDefinition
  operationCatalog: OperationDefinition[]
}

describe('MIP admin client/server operation contract', () => {
  it('retries all and only server-declared query operations', () => {
    const queryActions = catalog.operationCatalog
      .filter(operation => operation.kind === 'QUERY')
      .map(operation => operation.action)
      .sort()
    const mutationActions = catalog.operationCatalog
      .filter(operation => operation.kind === 'MUTATION')
      .map(operation => operation.action)

    expect([...readActions].sort()).toEqual(queryActions)
    for (const action of mutationActions) {
      expect(readActions.has(action)).toBe(false)
    }
    expect(readActions.has(catalog.healthOperation.action)).toBe(false)
  })
})
