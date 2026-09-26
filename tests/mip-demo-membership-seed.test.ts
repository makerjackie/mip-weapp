import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function seed(args: string[], overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/seed-membership-content-demo.mjs', ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, MIP_DEPLOYMENT_STAGE: 'test', MIP_CATALOG_STAGE: 'TEST', MIP_PAYMENT_MODE: 'test', ...overrides },
  })
}

describe('membership demo seed boundaries', () => {
  it('defaults to a bounded dry run without connecting to the cloud', () => {
    const result = seed([])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ apply: false, benefits: 4, tasks: 4, userMutations: 0 })
  })
  it('rejects production, live payment and writes without exact confirmations', () => {
    for (const overrides of [{ MIP_DEPLOYMENT_STAGE: 'production' }, { MIP_PAYMENT_MODE: 'live' }]) {
      const result = seed([], overrides)
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Demo content requires a non-production TEST catalog')
    }
    const result = seed(['--apply'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Apply requires exact environment/app confirmation')
  })
})
