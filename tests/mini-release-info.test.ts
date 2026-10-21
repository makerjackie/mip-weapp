import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMiniProgramReleaseInfo } from '../src/platform/wechat/release-info'

afterEach(() => vi.unstubAllGlobals())

describe('visible mini program release information', () => {
  it('uses the installed trial version and retains the actual test target', () => {
    vi.stubGlobal('wx', { getAccountInfoSync: () => ({ miniProgram: { version: '1.2.5-test.1021', envVersion: 'trial' } }) })
    expect(readMiniProgramReleaseInfo('0.2.0', true)).toEqual({ version: '1.2.5-test.1021', environmentText: '测试环境 · 体验版' })
  })
  it('does not mistake a production-connected trial for a test environment', () => {
    vi.stubGlobal('wx', { getAccountInfoSync: () => ({ miniProgram: { version: '1.2.5', envVersion: 'trial' } }) })
    expect(readMiniProgramReleaseInfo('0.2.0', false)).toEqual({ version: '1.2.5', environmentText: '生产环境 · 体验版' })
  })
  it('uses the baked upload version when DevTools omits version information', () => {
    vi.stubGlobal('wx', { getAccountInfoSync: () => ({ miniProgram: { version: '', envVersion: 'develop' } }) })
    expect(readMiniProgramReleaseInfo('1.2.5-test.1021', true)).toEqual({ version: '1.2.5-test.1021', environmentText: '测试环境 · 开发版' })
  })
  it('keeps settings usable when the host cannot return account information', () => {
    vi.stubGlobal('wx', { getAccountInfoSync: () => {
      throw new Error('unsupported')
    } })
    expect(readMiniProgramReleaseInfo('1.2.5-test.1021', true).version).toBe('1.2.5-test.1021')
  })
})
