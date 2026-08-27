import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/packages/member/benefits/index.ts', import.meta.url), 'utf8')
const runtimeContract = JSON.parse(readFileSync(new URL('../config/runtime-pages.json', import.meta.url), 'utf8'))

describe('membership benefits readiness', () => {
  it('does not report ready before the authoritative membership snapshot is known', () => {
    expect(source).toContain('membershipResult.status === \'rejected\' && !this.data.membershipKnown')
    expect(source).toContain('this.setData({ state: \'error\', message: \'会员权益暂时无法加载。\' })')

    const route = runtimeContract.routes.find((item: { path: string }) => item.path === 'packages/member/benefits/index')
    expect(route).toMatchObject({
      kind: 'data',
      states: ['loading', 'ready', 'error'],
      readyAssertion: 'state === \'ready\'',
    })
  })

  it('keeps an already trusted membership snapshot when a refresh fails', () => {
    expect(source).toContain('if (membershipResult.status === \'rejected\' && !this.data.membershipKnown)')
    expect(source).toContain('? \'会员状态暂时无法更新。\'')
  })

  it('shares one in-flight request across repeated page shows', () => {
    expect(source).toContain('loadPromise: null as Promise<void> | null')
    expect(source).toContain('if (this.loadPromise)')
    expect(source).toContain('const loadPromise = this.loadOnce()')
    expect(source).toContain('this.loadPromise = null')
  })
})
