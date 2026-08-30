import fs from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveKnowledgeWebviewUrl } from '../src/modules/mip-knowledge/webview-url'

const knowledgeModule = vi.hoisted(() => ({
  getContent: vi.fn(),
}))

vi.mock('../src/modules/mip-knowledge/module', () => ({
  mipKnowledgeModule: knowledgeModule,
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { knowledgeWebviewAllowedHosts: ['content.example.com'] },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition

function createPage() {
  const page = Object.create(definition) as PageDefinition
  page.data = structuredClone(definition.data)
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

function detail(externalUrl: string, unlocked = true) {
  return { access: { unlocked }, externalUrl }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-knowledge/web/index')
})

beforeEach(() => {
  knowledgeModule.getContent.mockReset()
})

describe('MIP knowledge web content state', () => {
  it('accepts only exact allowlisted HTTPS URLs', () => {
    expect(resolveKnowledgeWebviewUrl(
      'https://content.example.com/article?id=1',
      ['content.example.com'],
    )).toBe('https://content.example.com/article?id=1')
    for (const value of [
      '',
      'http://content.example.com/article',
      'https://sub.content.example.com/article',
      'https://content.example.com:8443/article',
      'https://content.example.com/article#section',
      'not-a-url',
    ]) {
      expect(resolveKnowledgeWebviewUrl(value, ['content.example.com']), value).toBe('')
    }
    expect(resolveKnowledgeWebviewUrl('https://127.0.0.1/article', ['127.0.0.1'])).toBe('')
    expect(resolveKnowledgeWebviewUrl('https://content.example.com/article', ['*.example.com'])).toBe('')
  })

  it.each([
    { label: 'empty', value: '', unlocked: true },
    { label: 'locked', value: 'https://content.example.com/article', unlocked: false },
    { label: 'invalid', value: 'https://other.example.com/article', unlocked: true },
  ])('treats $label content as a normal unavailable state', async ({ value, unlocked }) => {
    const page = createPage()
    knowledgeModule.getContent.mockResolvedValueOnce(detail(value, unlocked))

    await Reflect.apply(page.loadContent as (...args: unknown[]) => Promise<void>, page, ['content-1'])

    expect(page.data).toMatchObject({ state: 'empty', url: '' })
  })

  it('renders the web view only after a valid URL and keeps network failure as error', async () => {
    const page = createPage()
    knowledgeModule.getContent.mockResolvedValueOnce(detail('https://content.example.com/article'))
    await Reflect.apply(page.loadContent as (...args: unknown[]) => Promise<void>, page, ['content-1'])
    expect(page.data).toMatchObject({
      state: 'ready',
      url: 'https://content.example.com/article',
    })

    knowledgeModule.getContent.mockRejectedValueOnce(new Error('network'))
    await Reflect.apply(page.loadContent as (...args: unknown[]) => Promise<void>, page, ['content-1'])
    expect(page.data).toMatchObject({ state: 'error', url: '' })

    const view = fs.readFileSync(
      new URL('../src/packages/member/mip-knowledge/web/index.wxml', import.meta.url),
      'utf8',
    )
    expect(view).toContain('<web-view wx:if="{{state === \'ready\'}}"')
    expect(view).toContain('wx:elif="{{state === \'empty\'}}"')
  })
})
