import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

function permissionHelper(source: string) {
  const start = source.indexOf('function disableClientInvocation(functionName)')
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start).trim()
}

function normalizedCommandSource(source: string) {
  return source.replace(/\\\s+/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('MIP payment deployment contract', () => {
  it('uses the core deployment permission convergence helper', () => {
    const coreDeploy = read('scripts/deploy-functions.mjs')
    const paymentDeploy = read('scripts/deploy-payment-function.mjs')

    expect(permissionHelper(paymentDeploy)).toBe(permissionHelper(coreDeploy))
    expect(paymentDeploy).toContain('enableAuthenticatedClientInvocation(paymentFunction)')
    expect(paymentDeploy).toContain('disableClientInvocation(callbackFunction)')
    expect(paymentDeploy).toContain('disableClientInvocation(refundFunction)')
    expect(paymentDeploy).toContain('disableClientInvocation(ledgerFunction)')
    expect(paymentDeploy).toContain('paymentClientInvocationEnabled: true')
  })

  it('verifies the public payment adapter and protected internal functions separately', () => {
    const verify = read('scripts/verify-cloud.mjs')
    expect(verify).toMatch(/assertClientInvocationEnabled\(functionNames\.pay\)[\s\S]*assertClientInvocationDisabled\(functionNames\.callback\)[\s\S]*assertClientInvocationDisabled\(functionNames\.refund\)[\s\S]*assertClientInvocationDisabled\(functionNames\.ledger\)/)
  })

  it('documents every destructive or privileged setup confirmation', () => {
    const requiredCommands = [
      'pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --backup-manifest=/absolute/path/to/manifest.json',
      'pnpm cloud:deploy-payment -- --confirm-env=<EnvID> --confirm-function=mip-cloudpay --confirm-callback=mip-cloudpay-callback --confirm-refund=mip-refund-worker',
      'pnpm admin:bootstrap -- --confirm-env=<EnvID> --confirm-owner',
      'pnpm seed:demo -- --confirm-env=<EnvID> --confirm-demo',
    ]

    const deployment = normalizedCommandSource(read('docs/DEPLOYMENT.md'))
    for (const command of requiredCommands) {
      expect(deployment, `docs/DEPLOYMENT.md is missing: ${command}`).toContain(command)
    }
    expect(deployment).toContain('--confirm-live')
    expect(read('README.md')).toContain('(docs/DEPLOYMENT.md)')
    expect(read('docs/OPERATIONS.md')).toContain('(DEPLOYMENT.md)')
  })
})
