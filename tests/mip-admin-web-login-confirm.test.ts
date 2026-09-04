import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
    }
  }
  return {
    MipAdminError,
    beginProtectedAction: vi.fn(),
    confirmWebLoginToken: vi.fn(),
    consumePendingResume: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: mocks.MipAdminError,
  mipAdminModule: {
    session: { confirmWebLoginToken: mocks.confirmWebLoginToken },
  },
}))

vi.mock('../src/modules/mip-identity', () => ({
  mipAccessPageUrl: (token: string) => `/packages/member/mip-access/index?token=${token}`,
}))

vi.mock('../src/modules/mip-identity/client', () => ({
  mipIdentityModule: {
    beginProtectedAction: mocks.beginProtectedAction,
    consumePendingResume: mocks.consumePendingResume,
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const navigateTo = vi.fn()

function createPage() {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown>
}

beforeAll(async () => {
  vi.stubGlobal('wx', { navigateTo })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/web-login-confirm/index')
})

beforeEach(() => {
  navigateTo.mockReset()
  mocks.beginProtectedAction.mockReset().mockResolvedValue({ decision: { ready: true } })
  mocks.confirmWebLoginToken.mockReset().mockResolvedValue({ confirmed: true })
  mocks.consumePendingResume.mockReset().mockReturnValue(null)
})

describe('mini-program-code Web login confirmation', () => {
  it('keeps the scene outside page data and never confirms during onLoad', () => {
    const source = readFileSync(
      new URL('../src/packages/admin/web-login-confirm/index.ts', import.meta.url),
      'utf8',
    )
    const template = readFileSync(
      new URL('../src/packages/admin/web-login-confirm/index.wxml', import.meta.url),
      'utf8',
    )
    const page = createPage()

    callPage(page, 'onLoad', { scene: '0123456789abcdefghijklmnopqrstuv' })

    expect(page.data.state).toBe('ready')
    expect(JSON.stringify(page.data)).not.toContain('0123456789abcdefghijklmnopqrstuv')
    expect(mocks.confirmWebLoginToken).not.toHaveBeenCalled()
    expect(source).not.toContain('setStorage')
    expect(template).toContain('id="admin-web-login-confirm-page"')
    expect(template).toContain('id="admin-web-login-confirm-button"')
  })

  it('requires an explicit tap before confirming the exact scene token', async () => {
    const page = createPage()
    const token = '0123456789abcdefghijklmnopqrstuv'
    callPage(page, 'onLoad', { scene: token })

    await callPage(page, 'confirmWebLogin')

    expect(mocks.beginProtectedAction).toHaveBeenCalledWith({
      action: 'ENTER_ADMIN',
      requiredCapability: 'admin:enter',
      source: { navigation: 'navigateBack' },
    })
    expect(mocks.confirmWebLoginToken).toHaveBeenCalledWith(token)
    expect(page.data.state).toBe('success')
  })

  it('resumes a user-requested confirmation after the existing access flow returns', async () => {
    mocks.beginProtectedAction.mockResolvedValueOnce({
      token: 'identity-intent',
      decision: { ready: false, block: 'PHONE_REQUIRED' },
    })
    mocks.consumePendingResume.mockReturnValueOnce({
      action: 'ENTER_ADMIN',
      source: { navigation: 'navigateBack' },
    })
    const page = createPage()
    const token = '0123456789abcdefghijklmnopqrstuv'
    callPage(page, 'onLoad', { scene: token })

    await callPage(page, 'confirmWebLogin')
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/packages/member/mip-access/index?token=identity-intent',
    }))
    callPage(page, 'onShow')
    await vi.waitFor(() => expect(mocks.confirmWebLoginToken).toHaveBeenCalledWith(token))
    expect(page.data.state).toBe('success')
  })

  it('fails closed for an invalid scene or missing admin capability', async () => {
    const invalid = createPage()
    callPage(invalid, 'onLoad', { scene: 'short' })
    await callPage(invalid, 'confirmWebLogin')
    expect(invalid.data.state).toBe('expired')
    expect(mocks.confirmWebLoginToken).not.toHaveBeenCalled()

    mocks.beginProtectedAction.mockResolvedValueOnce({
      decision: { ready: false, block: 'FORBIDDEN' },
    })
    const forbidden = createPage()
    callPage(forbidden, 'onLoad', { scene: '0123456789abcdefghijklmnopqrstuv' })
    await callPage(forbidden, 'confirmWebLogin')
    expect(forbidden.data).toMatchObject({
      state: 'forbidden',
      message: '当前账号没有运营管理权限。',
    })
  })
})
