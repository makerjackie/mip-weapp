import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPaymentModeSwitchGates,
  PAYMENT_SWITCH_ROLES,
  planPaymentModeEnvironment,
  testMembershipHmacRequired,
} from '../scripts/lib/payment-mode-switch.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const BASE = {
  paymentMode: 'test',
  catalogStage: 'TEST',
  deploymentStage: 'test',
} as const

function currentEnvironment() {
  // 模拟现网函数环境：支付键 + 必须逐字节保留的非支付键（含密钥形态的值）。
  return {
    MIP_DB_CONNECTION_URI: 'mysql://runtime:[redacted]@10.0.0.3:3306/mip',
    MIP_ALLOWED_APP_IDS: 'wx1111111111111111',
    MIP_IDENTITY_PEPPER: 'pepper-value-32-chars-minimum!!',
    MIP_WECHAT_APP_SECRET: 'mock-secret-value-32-chars-minimum!',
    MIP_PAYMENT_MODE: 'disabled',
  }
}

function extraBlock(source: string, role: string) {
  const marker = `    ${role}: {`
  const start = source.indexOf(marker)
  expect(start, `environmentForRole block for ${role}`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('\n    },', start)
  return source.slice(start, end)
}

describe('payment mode switch gates', () => {
  it('accepts the deploy-legal mode and stage combinations', () => {
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'disabled', catalogStage: 'TEST', confirmLive: false })).not.toThrow()
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'test', catalogStage: 'TEST', confirmLive: false })).not.toThrow()
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'test', catalogStage: 'TEST', confirmLive: true })).not.toThrow()
  })

  it('mirrors the deploy gate messages for invalid values', () => {
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'shadow', catalogStage: 'TEST', confirmLive: false }))
      .toThrow('MIP_PAYMENT_MODE must be disabled, test, or live')
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'test', catalogStage: 'PROD', confirmLive: false }))
      .toThrow('MIP_CATALOG_STAGE must be TEST or LIVE')
  })

  it('requires --confirm-live for live payment or LIVE catalog', () => {
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'live', catalogStage: 'LIVE', confirmLive: false }))
      .toThrow('Live payment or catalog switch requires --confirm-live')
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'live', catalogStage: 'TEST', confirmLive: false }))
      .toThrow('Live payment or catalog switch requires --confirm-live')
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'live', catalogStage: 'LIVE', confirmLive: true })).not.toThrow()
  })

  it('keeps the LIVE catalog welded to live payment', () => {
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'test', catalogStage: 'LIVE', confirmLive: true }))
      .toThrow('LIVE catalog requires MIP_PAYMENT_MODE=live')
    expect(() => assertPaymentModeSwitchGates({ paymentMode: 'disabled', catalogStage: 'LIVE', confirmLive: true }))
      .toThrow('LIVE catalog requires MIP_PAYMENT_MODE=live')
  })
})

describe('ledger test-membership HMAC condition', () => {
  it('follows the deploy condition stages, TEST catalog, and non-live payment', () => {
    for (const deploymentStage of ['development', 'test', 'staging']) {
      expect(testMembershipHmacRequired({ deploymentStage, catalogStage: 'TEST', paymentMode: 'disabled' })).toBe(true)
      expect(testMembershipHmacRequired({ deploymentStage, catalogStage: 'TEST', paymentMode: 'test' })).toBe(true)
      expect(testMembershipHmacRequired({ deploymentStage, catalogStage: 'TEST', paymentMode: 'live' })).toBe(false)
      expect(testMembershipHmacRequired({ deploymentStage, catalogStage: 'LIVE', paymentMode: 'live' })).toBe(false)
    }
    expect(testMembershipHmacRequired({ deploymentStage: 'production', catalogStage: 'TEST', paymentMode: 'test' })).toBe(false)
  })
})

describe('planPaymentModeEnvironment', () => {
  it('overlays only the payment keys and preserves every other key byte-for-byte', () => {
    const before = currentEnvironment()
    const plan = planPaymentModeEnvironment({
      role: 'events',
      currentEnvironment: before,
      ...BASE,
    })
    expect(plan.changes).toEqual([{ key: 'MIP_PAYMENT_MODE', from: 'disabled', to: 'test' }])
    expect(plan.environment.MIP_PAYMENT_MODE).toBe('test')
    // 非支付键必须与现网完全一致（读-改-写承诺）。
    for (const [key, value] of Object.entries(before)) {
      if (key === 'MIP_PAYMENT_MODE') {
        continue
      }
      expect(plan.environment[key as keyof typeof plan.environment]).toBe(value)
    }
    expect(Object.keys(plan.environment).sort()).toEqual(Object.keys(before).sort())
  })

  it('covers the role key table across core and payment suites', () => {
    const before = currentEnvironment()
    for (const role of ['commerce', 'community', 'admin', 'ledger', 'pay', 'callback', 'refund']) {
      const plan = planPaymentModeEnvironment({
        role,
        currentEnvironment: before,
        testMembershipHmac: 'local-hmac-32-chars-minimum-!!!!!!',
        ...BASE,
      })
      const touched = new Set(plan.changes.map(change => change.key))
      expect(touched.size, role).toBeGreaterThan(0)
      expect(touched.has('MIP_DB_CONNECTION_URI'), role).toBe(false)
      expect(touched.has('MIP_WECHAT_APP_SECRET'), role).toBe(false)
    }
    expect(planPaymentModeEnvironment({ role: 'events', currentEnvironment: before, ...BASE }).changes.map(change => change.key))
      .toEqual(['MIP_PAYMENT_MODE'])
    expect(planPaymentModeEnvironment({ role: 'commerce', currentEnvironment: before, ...BASE }).changes.map(change => change.key).sort())
      .toEqual(['MIP_CATALOG_STAGE', 'MIP_PAYMENT_MODE'])
    expect(planPaymentModeEnvironment({ role: 'community', currentEnvironment: before, ...BASE }).changes.map(change => change.key))
      .toEqual(['MIP_CATALOG_STAGE'])
    expect(planPaymentModeEnvironment({ role: 'pay', currentEnvironment: before, ...BASE }).changes.map(change => change.key))
      .toEqual(['MIP_PAYMENT_MODE'])
  })

  it('is idempotent once the environment matches the target', () => {
    const before = currentEnvironment()
    const first = planPaymentModeEnvironment({ role: 'commerce', currentEnvironment: before, ...BASE })
    const second = planPaymentModeEnvironment({
      role: 'commerce',
      currentEnvironment: first.environment,
      ...BASE,
    })
    expect(second.changes).toEqual([])
    expect(second.environment).toEqual(first.environment)
  })

  it('keeps the deployed test-membership HMAC when the condition holds', () => {
    const deployedHmac = 'same-hmac-value-32-chars-minimum!!!!!!'
    const before = { ...currentEnvironment(), MIP_TEST_MEMBERSHIP_HMAC_SECRET: deployedHmac }
    const plan = planPaymentModeEnvironment({
      role: 'ledger',
      currentEnvironment: before,
      testMembershipHmac: deployedHmac,
      ...BASE,
    })
    expect(plan.changes.filter(change => change.key === 'MIP_TEST_MEMBERSHIP_HMAC_SECRET')).toEqual([])
    expect(plan.environment.MIP_TEST_MEMBERSHIP_HMAC_SECRET).toBe(deployedHmac)
  })

  it('refuses to overwrite a deployed HMAC with a different local value', () => {
    const before = { ...currentEnvironment(), MIP_TEST_MEMBERSHIP_HMAC_SECRET: 'deployed-hmac-32-chars-minimum!!!!' }
    expect(() => planPaymentModeEnvironment({
      role: 'ledger',
      currentEnvironment: before,
      testMembershipHmac: 'local-hmac-32-chars-minimum-!!!!!!',
      ...BASE,
    })).toThrow('MIP_TEST_MEMBERSHIP_HMAC_SECRET differs from the deployed MIP value')
  })

  it('sets the HMAC from the env directory only when the deployed value is missing', () => {
    const plan = planPaymentModeEnvironment({
      role: 'ledger',
      currentEnvironment: currentEnvironment(),
      testMembershipHmac: 'local-hmac-32-chars-minimum-!!!!!!',
      ...BASE,
    })
    expect(plan.changes).toContainEqual({ key: 'MIP_TEST_MEMBERSHIP_HMAC_SECRET', from: null, to: '<configured>' })
    expect(plan.environment.MIP_TEST_MEMBERSHIP_HMAC_SECRET).toBe('local-hmac-32-chars-minimum-!!!!!!')
  })

  it('never generates a secret: a missing HMAC with no local value stops the switch', () => {
    expect(() => planPaymentModeEnvironment({
      role: 'ledger',
      currentEnvironment: currentEnvironment(),
      testMembershipHmac: '',
      ...BASE,
    })).toThrow('MIP_TEST_MEMBERSHIP_HMAC_SECRET')
  })

  it('removes the HMAC when the condition no longer holds', () => {
    const before = { ...currentEnvironment(), MIP_TEST_MEMBERSHIP_HMAC_SECRET: 'deployed-hmac-32-chars-minimum!!!!' }
    const plan = planPaymentModeEnvironment({
      role: 'ledger',
      currentEnvironment: before,
      paymentMode: 'live',
      catalogStage: 'LIVE',
      deploymentStage: 'production',
    })
    expect(plan.changes).toContainEqual({ key: 'MIP_TEST_MEMBERSHIP_HMAC_SECRET', from: '<configured>', to: null })
    expect(plan.environment.MIP_TEST_MEMBERSHIP_HMAC_SECRET).toBeUndefined()
  })

  it('rejects roles outside the payment switch table', () => {
    expect(() => planPaymentModeEnvironment({ role: 'identity', currentEnvironment: currentEnvironment(), ...BASE }))
      .toThrow('Unsupported payment switch role: identity')
  })
})

describe('switch contract with the deployment scripts', () => {
  it('keeps the role key table aligned with environmentForRole', () => {
    const deploy = read('scripts/deploy-functions.mjs')
    expect(extraBlock(deploy, 'events')).toContain('MIP_PAYMENT_MODE: options.paymentMode')
    expect(extraBlock(deploy, 'events')).not.toContain('MIP_CATALOG_STAGE')
    expect(extraBlock(deploy, 'commerce')).toContain('MIP_PAYMENT_MODE: options.paymentMode')
    expect(extraBlock(deploy, 'commerce')).toContain('MIP_CATALOG_STAGE: options.catalogStage')
    expect(extraBlock(deploy, 'community')).toContain('MIP_CATALOG_STAGE: options.catalogStage')
    expect(extraBlock(deploy, 'community')).not.toContain('MIP_PAYMENT_MODE')
    expect(extraBlock(deploy, 'admin')).toContain('MIP_CATALOG_STAGE: options.catalogStage')
    expect(extraBlock(deploy, 'admin')).not.toContain('MIP_PAYMENT_MODE')
    const ledgerBlock = extraBlock(deploy, 'ledger')
    expect(ledgerBlock).toContain('MIP_PAYMENT_MODE: options.paymentMode')
    expect(ledgerBlock).toContain('MIP_CATALOG_STAGE: options.catalogStage')
    expect(ledgerBlock).toContain('options.catalogStage === \'TEST\'')
    expect(ledgerBlock).toContain('MIP_TEST_MEMBERSHIP_HMAC_SECRET: options.secrets.testMembershipHmac')
    expect(deploy).toContain('[\'development\', \'test\', \'staging\'].includes(options.deploymentStage)')
  })

  it('keeps the payment suite roles aligned with commonEnvironment', () => {
    const paymentDeploy = read('scripts/deploy-payment-function.mjs')
    const commonStart = paymentDeploy.indexOf('const commonEnvironment')
    const commonEnd = paymentDeploy.indexOf('})', commonStart)
    const common = paymentDeploy.slice(commonStart, commonEnd)
    expect(common).toContain('MIP_PAYMENT_MODE')
    for (const role of ['pay', 'callback', 'refund']) {
      expect(Object.keys(PAYMENT_SWITCH_ROLES), role).toContain(role)
    }
  })

  it('switches through the deployment planner with masked HMAC output and a dry-run', () => {
    const source = read('scripts/switch-payment-mode.mjs')
    expect(source).toContain('assertPaymentModeSwitchGates({ paymentMode, catalogStage, confirmLive })')
    expect(source).toContain('planExistingFunctionConfigurationUpdate({')
    expect(source).toContain('existingFunctionConfigurationConverged({')
    expect(source).toContain('--dry-run')
    expect(source).toContain('--confirm-live')
    expect(source).toContain('argumentValue(\'--confirm-env=\')')
    // HMAC 值永不落日志：展示层只允许 <configured>/<absent> 占位。
    expect(source).toContain('\'<configured>\'')
    expect(source).toContain('\'<absent>\'')
    expect(source).not.toMatch(/console\.log\([^)]*plan\.environment/)
  })
})
