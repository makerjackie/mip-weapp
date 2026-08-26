import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'
import { adminOperationContract } from '../src/modules/mip-admin/operation-contract'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

interface OperationDefinition {
  action: string
  kind: 'QUERY' | 'MUTATION'
  authentication: 'REQUIRED'
  session: 'REQUIRED'
  safeToRetry: boolean
  idempotencyKeyRequired: null
}

const require = createRequire(import.meta.url)
const { publicOperationContract } = require('../cloudfunctions/mip-admin-api/domain/public-operation-contract') as {
  publicOperationContract: {
    version: number
    operationCount: number
    operations: OperationDefinition[]
  }
}

describe('MIP admin client/server operation contract', () => {
  it('consumes the exact generated platform-neutral contract', () => {
    expect(adminOperationContract).toEqual(publicOperationContract)
    expect(adminOperationContract.operationCount).toBe(144)
    expect(adminOperationContract.operations).toHaveLength(144)
  })

  it('retries all and only contract-declared safe operations', () => {
    const queryActions = publicOperationContract.operations
      .filter(operation => operation.safeToRetry)
      .map(operation => operation.action)
      .sort()
    const nonRetryableActions = publicOperationContract.operations
      .filter(operation => !operation.safeToRetry)
      .map(operation => operation.action)

    expect([...readActions].sort()).toEqual(queryActions)
    for (const action of nonRetryableActions) {
      expect(readActions.has(action)).toBe(false)
    }
    expect(readActions.has('health')).toBe(false)
  })
})
