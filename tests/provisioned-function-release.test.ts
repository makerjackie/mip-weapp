import assert from 'node:assert/strict'
import { it } from 'vitest'
import { releaseProvisionedFunction } from '../scripts/lib/provisioned-function-release.mjs'

it('deployment warms new version before traffic switch and retires only old default', async () => {
  const calls: { action: string, params: { Qualifier?: string } }[] = []
  let version = '1'
  const call = async (action: string, params: { Qualifier?: string, FunctionVersion?: string }) => {
    calls.push({ action, params })
    if (action === 'ListAliases') {
      return { Aliases: [{ Name: '$DEFAULT', FunctionVersion: version, RoutingConfig: {} }] }
    }
    if (action === 'GetProvisionedConcurrencyConfig') {
      return { Allocated: [{ Qualifier: params.Qualifier || '1', AllocatedProvisionedConcurrencyNum: 1, AvailableProvisionedConcurrencyNum: 1, Status: 'Done' }] }
    }
    if (action === 'GetFunction') {
      return { Status: 'Active' }
    }
    if (action === 'PublishVersion') {
      return { FunctionVersion: '2' }
    }
    if (action === 'UpdateAlias') {
      version = String(params.FunctionVersion)
    }
    return {}
  }
  const result = await releaseProvisionedFunction({ call, functionName: 'mip-events-api', namespace: 'test' })
  assert.equal(result?.version, '2')
  assert.ok(calls.findIndex(c => c.action === 'PutProvisionedConcurrencyConfig') < calls.findIndex(c => c.action === 'UpdateAlias'))
  assert.ok(calls.findIndex(c => c.action === 'UpdateAlias') < calls.findIndex(c => c.action === 'DeleteProvisionedConcurrencyConfig'))
  assert.equal(calls.at(-1)?.params.Qualifier, '1')
})

it('unprovisioned deployments stay on latest and never incur new idle charges', async () => {
  const calls: string[] = []
  const result = await releaseProvisionedFunction({ functionName: 'mip-t-events-api', namespace: 'test', call: async (action: string) => {
    calls.push(action)
    return action === 'ListAliases' ? { Aliases: [{ Name: '$DEFAULT', FunctionVersion: '$LATEST' }] } : { Allocated: [] }
  } })
  assert.equal(result, null)
  assert.deepEqual(calls, ['ListAliases', 'GetProvisionedConcurrencyConfig'])
})

it('failed warm-up leaves traffic on the working version', async () => {
  const calls: string[] = []
  await assert.rejects(releaseProvisionedFunction({ functionName: 'mip-events-api', namespace: 'test', instances: 1, call: async (action: string, params: { Qualifier?: string, FunctionVersion?: string }) => {
    calls.push(action)
    if (action === 'ListAliases') {
      return { Aliases: [{ Name: '$DEFAULT', FunctionVersion: '$LATEST' }] }
    }
    if (action === 'GetFunction') {
      return { Status: 'Active' }
    }
    if (action === 'PublishVersion') {
      return { FunctionVersion: '1' }
    }
    if (action === 'GetProvisionedConcurrencyConfig') {
      return { Allocated: params.Qualifier ? [{ Qualifier: '1', Status: 'Failed' }] : [] }
    }
    return {}
  } }), /failed/)
  assert.equal(calls.includes('UpdateAlias'), false)
})
