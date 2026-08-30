import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeModule = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listContents: vi.fn(),
}))

vi.mock('../src/modules/mip-knowledge/module', () => ({
  mipKnowledgeModule: knowledgeModule,
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

function touch(dataset: PageData) {
  return { currentTarget: { dataset } } as unknown as WechatMiniprogram.TouchEvent
}

function content(id: string, accessType: 'FREE' | 'MEMBER' | 'MEMBER_OR_PAID' = 'FREE') {
  return {
    id,
    contentType: 'ARTICLE' as const,
    title: id,
    summary: '',
    authorName: '',
    accessType,
    category: { id: 'category-1', name: '玩家攻略' },
    sourceName: 'MIP',
    coverUrl: '',
    product: null,
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    navigateTo: vi.fn(),
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-knowledge/index')
})

beforeEach(() => {
  knowledgeModule.listCategories.mockReset().mockResolvedValue([])
  knowledgeModule.listContents.mockReset().mockResolvedValue({ items: [], nextCursor: '' })
})

describe('MIP knowledge access filter', () => {
  it('offers all supported access types with user-facing labels', () => {
    const page = createPage()
    const template = readFileSync(new URL('../src/packages/member/mip-knowledge/index.wxml', import.meta.url), 'utf8')

    expect(page.data.accessOptions).toEqual([
      { value: '', label: '全部' },
      { value: 'FREE', label: '公开' },
      { value: 'MEMBER', label: '玩家可读' },
      { value: 'MEMBER_OR_PAID', label: '玩家或单独购买' },
    ])
    expect(template).toContain('scroll-x enhanced')
    expect(template).toContain('data-access-type="{{item.value}}"')
    expect(template).toContain('bind:tap="chooseAccess"')
    expect(template).toContain('accessType === item.value')
  })

  it('reloads the first page with the selected access type', async () => {
    const page = createPage({
      items: [content('old')],
      nextCursor: 'old-cursor',
      state: 'ready',
    })
    knowledgeModule.listContents.mockResolvedValueOnce({
      items: [content('member', 'MEMBER')],
      nextCursor: 'member-cursor',
    })

    callPage(page, 'chooseAccess', touch({ accessType: 'MEMBER' }))

    expect(page.data.state).toBe('loading')
    expect(page.data.items).toEqual([])
    await vi.waitFor(() => expect(knowledgeModule.listContents).toHaveBeenCalledWith(expect.objectContaining({
      accessType: 'MEMBER',
      limit: 20,
    })))
    await vi.waitFor(() => expect(page.data.items).toEqual([
      expect.objectContaining({ id: 'member', accessLabel: '玩家可读' }),
    ]))
    expect(page.data.nextCursor).toBe('member-cursor')
  })

  it('keeps the access type when loading the next page', async () => {
    const first = content('first', 'MEMBER_OR_PAID')
    const page = createPage({
      accessType: 'MEMBER_OR_PAID',
      items: [{ ...first, typeLabel: '图文', accessLabel: '玩家或单独购买', priceLabel: '' }],
      nextCursor: 'next-page',
      state: 'ready',
    })
    knowledgeModule.listContents.mockResolvedValueOnce({
      items: [content('second', 'MEMBER_OR_PAID')],
      nextCursor: '',
    })

    await callPage(page, 'loadMore')

    expect(knowledgeModule.listContents).toHaveBeenCalledWith(expect.objectContaining({
      accessType: 'MEMBER_OR_PAID',
      cursor: 'next-page',
      limit: 20,
    }))
    expect(page.data.items).toEqual([
      expect.objectContaining({ id: 'first' }),
      expect.objectContaining({ id: 'second', accessLabel: '玩家或单独购买' }),
    ])
  })
})
