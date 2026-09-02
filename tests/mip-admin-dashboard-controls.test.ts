import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const adminMocks = vi.hoisted(() => {
  class MipAdminError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
    }
  }
  return {
    MipAdminError,
    getSession: vi.fn(),
    confirmWebLogin: vi.fn(),
  }
})

vi.mock('../src/modules/mip-admin', () => ({
  MipAdminError: adminMocks.MipAdminError,
  mipAdminModule: {
    session: {
      get: adminMocks.getSession,
      confirmWebLogin: adminMocks.confirmWebLogin,
    },
  },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
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
  vi.stubGlobal('wx', {
    navigateTo: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/admin/dashboard/index')
})

beforeEach(() => {
  adminMocks.getSession.mockReset().mockResolvedValue({ enabled: true, capabilities: [], roles: [] })
  adminMocks.confirmWebLogin.mockReset().mockResolvedValue({ confirmed: true })
})

describe('onsite dashboard and Web login confirmation', () => {
  it('keeps stable runtime selectors and the single onsite entry', () => {
    const template = readFileSync(new URL('../src/packages/admin/dashboard/index.wxml', import.meta.url), 'utf8')
    expect(template).toContain('id="admin-web-login-code-input"')
    expect(template).toContain('id="admin-web-login-confirm-button"')
    expect(template).toContain('现场工作台')
    expect(template).toContain('bind:tap="openEvents"')
  })

  it('normalizes and confirms exactly six Web login digits', async () => {
    const page = createPage()
    callPage(page, 'changeWebLoginCode', { detail: { value: 'abcd234567' } })
    await callPage(page, 'confirmWebLogin')

    expect(adminMocks.confirmWebLogin).toHaveBeenCalledWith('234567')
    expect(page.data).toMatchObject({ webLoginBusy: false, webLoginConfirmed: true })
  })

  it('maps invalid or expired codes to actionable local messages', async () => {
    adminMocks.confirmWebLogin.mockRejectedValueOnce(
      new adminMocks.MipAdminError('WEB_LOGIN_INVALID_CODE', 'raw service error'),
    )
    const page = createPage({ webLoginCode: '123456' })
    await callPage(page, 'confirmWebLogin')

    expect(page.data.webLoginError).toBe('登录码无效或已过期，请在网页获取新的登录码。')
    expect(page.data.webLoginBusy).toBe(false)
  })
})
