import type { AdminEventTagAssignments } from '../src/modules/mip-admin'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const adminMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getTagAssignments: vi.fn(),
  replaceTagAssignments: vi.fn(),
  getEvent: vi.fn(),
  saveEvent: vi.fn(),
  changeEventStatus: vi.fn(),
}))

vi.mock('../src/modules/mip-admin', () => ({
  hasCapability: (grants: Array<{ capability: string }>, capability: string) =>
    grants.some(grant => grant.capability === capability),
  mipAdminModule: {
    getSession: adminMocks.getSession,
    eventCatalogs: {
      getTagAssignments: adminMocks.getTagAssignments,
      replaceTagAssignments: adminMocks.replaceTagAssignments,
    },
    events: {
      get: adminMocks.getEvent,
      save: adminMocks.saveEvent,
      changeStatus: adminMocks.changeEventStatus,
    },
  },
}))
vi.mock('../src/modules/mip-identity/client', () => ({
  mipBranchesModule: { load: vi.fn(async () => ({ branches: [] })) },
}))
vi.mock('../src/modules/mip-media/client', () => ({
  mipMediaModule: { uploadImageFromPath: vi.fn() },
}))
vi.mock('../src/modules/platform/image-upload', () => ({ chooseSingleImage: vi.fn() }))
vi.mock('../src/components/event-phone-preview/model', () => ({
  buildEventPhonePreview: vi.fn(() => ({})),
}))
vi.mock('../src/packages/admin/shared/page-state', () => ({
  adminLoadFailure: (error: unknown, options: { fallbackMessage: string }) => ({
    state: 'error',
    message: error instanceof Error ? error.message : options.fallbackMessage,
  }),
  isAdminVersionConflict: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'CONFLICT',
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const TAG_A_ID = '22222222-2222-4222-8222-222222222222'
const TAG_B_ID = '33333333-3333-4333-8333-333333333333'
const TAG_C_ID = '44444444-4444-4444-8444-444444444444'

const assignments: AdminEventTagAssignments = {
  eventId: EVENT_ID,
  eventVersion: 4,
  tags: [
    {
      id: TAG_A_ID,
      key: 'networking',
      name: '商务交流',
      description: '',
      sortOrder: 10,
      catalogStatus: 'ACTIVE',
      selectable: true,
      selected: true,
      assignmentVersion: 2,
    },
    {
      id: TAG_B_ID,
      key: 'roundtable',
      name: '圆桌交流',
      description: '',
      sortOrder: 20,
      catalogStatus: 'ACTIVE',
      selectable: true,
      selected: false,
      assignmentVersion: null,
    },
  ],
}

let definition: PageDefinition

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (!key.includes('.')) {
        page.data[key] = value
        continue
      }
      const path = key.split('.')
      let target = page.data
      for (const part of path.slice(0, -1)) {
        target = target[part] as PageData
      }
      target[path.at(-1) as string] = value
    }
  }
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as Promise<unknown> | void
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    showModal: vi.fn(),
    chooseLocation: vi.fn(),
    previewImage: vi.fn(),
  })
  vi.stubGlobal('Page', (value: PageDefinition) => {
    definition = value
  })
  await import('../src/packages/admin/events/index')
})

beforeEach(() => {
  vi.mocked(wx.showToast).mockReset()
  vi.mocked(wx.showModal).mockReset().mockResolvedValue({ confirm: true, cancel: false })
  adminMocks.getSession.mockReset()
  adminMocks.getTagAssignments.mockReset().mockResolvedValue(assignments)
  adminMocks.saveEvent.mockReset().mockResolvedValue({
    id: EVENT_ID,
    status: 'DRAFT',
    version: 5,
  })
  adminMocks.replaceTagAssignments.mockReset().mockResolvedValue({
    ...assignments,
    eventVersion: 5,
    tags: assignments.tags.map(tag => ({
      ...tag,
      selected: true,
      assignmentVersion: tag.assignmentVersion || 1,
    })),
    idempotent: false,
  })
  adminMocks.changeEventStatus.mockReset().mockResolvedValue({
    id: EVENT_ID,
    status: 'CANCELLED',
    version: 5,
  })
})

describe('MIP admin event tag editor', () => {
  it('loads controlled options and submits only selected option ids with event CAS', async () => {
    const page = createPage({
      eventId: EVENT_ID,
      version: 4,
      canManageTags: true,
      tagState: 'loading',
    })
    await callPage(page, 'loadEventTags', true)
    expect(page.data.tagState).toBe('ready')
    expect(page.data.selectedTagIds).toEqual([TAG_A_ID])

    callPage(page, 'toggleEventTag', { currentTarget: { dataset: { tagId: TAG_B_ID } } })
    expect(page.data.selectedTagIds).toEqual([TAG_A_ID, TAG_B_ID])
    expect(page.data.tagsDirty).toBe(true)

    await callPage(page, 'saveEventTags')
    expect(adminMocks.replaceTagAssignments).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_A_ID, TAG_B_ID],
    })
    expect(page.data.version).toBe(5)
    expect(page.data.tagsDirty).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '标签已保存', icon: 'success' })
  })

  it('degrades a failed catalog load to a non-editable state', async () => {
    adminMocks.getTagAssignments.mockRejectedValueOnce(new Error('目录暂时不可用'))
    const page = createPage({
      eventId: EVENT_ID,
      version: 4,
      canManageTags: true,
      tagState: 'loading',
    })

    await callPage(page, 'loadEventTags')

    expect(page.data.tagState).toBe('error')
    expect(page.data.tagMessage).toContain('目录暂时不可用')
    callPage(page, 'toggleEventTag', { currentTarget: { dataset: { tagId: TAG_B_ID } } })
    expect(page.data.selectedTagIds).toEqual([])
    expect(adminMocks.replaceTagAssignments).not.toHaveBeenCalled()
  })

  it('marks an assigned inactive catalog tag for removal without accepting its raw id', async () => {
    adminMocks.getTagAssignments.mockResolvedValueOnce({
      ...assignments,
      tags: [
        ...assignments.tags,
        {
          id: TAG_C_ID,
          key: 'retired',
          name: '已停用标签',
          description: '',
          sortOrder: 30,
          catalogStatus: 'INACTIVE',
          selectable: false,
          selected: true,
          assignmentVersion: 3,
        },
      ],
    })
    const page = createPage({
      eventId: EVENT_ID,
      version: 4,
      canManageTags: true,
      tagState: 'loading',
    })

    await callPage(page, 'loadEventTags')

    expect(page.data.selectedTagIds).toEqual([TAG_A_ID])
    expect(page.data.savedTagIds).toEqual([TAG_A_ID, TAG_C_ID])
    expect(page.data.tagsDirty).toBe(true)
    expect(page.data.hasUnavailableSelectedTags).toBe(true)
    await callPage(page, 'saveEventTags')
    expect(adminMocks.replaceTagAssignments).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      expectedVersion: 4,
      tagIds: [TAG_A_ID],
    })
  })

  it.each([
    { scopeType: 'BRANCH', scopeId: 'branch-a' },
    { scopeType: 'PLATFORM', scopeId: 'unexpected-scope' },
  ])('hides tags for a non-platform-null grant: $scopeType/$scopeId', async (grant) => {
    adminMocks.getSession.mockResolvedValueOnce({
      capabilities: [{ capability: 'events.catalog.manage', ...grant }],
    })
    const page = createPage({ eventId: EVENT_ID })

    await callPage(page, 'loadAccessAndBranches')

    expect(page.data.canManageTags).toBe(false)
    expect(page.data.tagState).toBe('hidden')
    expect(adminMocks.getTagAssignments).not.toHaveBeenCalled()
  })

  it('preserves local selections and requires an explicit refresh after a version conflict', async () => {
    const conflict = Object.assign(new Error('记录状态已变化'), { code: 'CONFLICT' })
    adminMocks.replaceTagAssignments.mockRejectedValueOnce(conflict)
    const page = createPage({
      eventId: EVENT_ID,
      version: 4,
      canManageTags: true,
      tagState: 'ready',
      tagOptions: assignments.tags,
      selectedTagIds: [TAG_A_ID, TAG_B_ID],
      savedTagIds: [TAG_A_ID],
      tagsDirty: true,
    })

    await callPage(page, 'saveEventTags')

    expect(page.data.conflict).toBe(true)
    expect(page.data.selectedTagIds).toEqual([TAG_A_ID, TAG_B_ID])
    expect(page.data.message).toContain('载入最新版本')
  })

  it('advances the tag snapshot with a successful cancellation and refreshes both facts after conflict', async () => {
    const page = createPage({
      eventId: EVENT_ID,
      eventStatus: 'PUBLISHED',
      version: 4,
      canManageTags: true,
      tagState: 'ready',
      tagSnapshotVersion: 4,
      tagsDirty: true,
      cancelReason: '计划调整',
    })

    await callPage(page, 'confirmCancelEvent')

    expect(page.data.eventStatus).toBe('CANCELLED')
    expect(page.data.version).toBe(5)
    expect(page.data.tagSnapshotVersion).toBe(5)
    expect(page.data.tagsDirty).toBe(true)

    const loadEvent = vi.fn(async () => {})
    const loadEventTags = vi.fn(async () => {})
    page.loadEvent = loadEvent
    page.loadEventTags = loadEventTags
    await callPage(page, 'refreshAfterCancelConflict')
    expect(loadEvent).toHaveBeenCalledWith(true)
    expect(loadEventTags).toHaveBeenCalledWith(true)
  })

  it('keeps tag save, event save, and cancellation mutually exclusive', async () => {
    const page = createPage({
      eventId: EVENT_ID,
      eventStatus: 'PUBLISHED',
      version: 4,
      canManageTags: true,
      tagState: 'ready',
      tagOptions: assignments.tags,
      selectedTagIds: [TAG_A_ID, TAG_B_ID],
      savedTagIds: [TAG_A_ID],
      tagsDirty: true,
      tagSaving: true,
      cancelReason: '计划调整',
    })

    callPage(page, 'toggleEventTag', { currentTarget: { dataset: { tagId: TAG_B_ID } } })
    await callPage(page, 'save')
    callPage(page, 'openCancelDialog')
    await callPage(page, 'confirmCancelEvent')
    expect(page.data.selectedTagIds).toEqual([TAG_A_ID, TAG_B_ID])
    expect(page.data.cancelDialogVisible).toBe(false)
    expect(adminMocks.saveEvent).not.toHaveBeenCalled()
    expect(adminMocks.changeEventStatus).not.toHaveBeenCalled()

    page.setData({ tagSaving: false, cancelBusy: true })
    await callPage(page, 'saveEventTags')
    await callPage(page, 'save')
    expect(adminMocks.replaceTagAssignments).not.toHaveBeenCalled()
    expect(adminMocks.saveEvent).not.toHaveBeenCalled()

    page.setData({ cancelBusy: false, saving: true })
    await callPage(page, 'saveEventTags')
    await callPage(page, 'confirmCancelEvent')
    expect(adminMocks.replaceTagAssignments).not.toHaveBeenCalled()
    expect(adminMocks.changeEventStatus).not.toHaveBeenCalled()
  })

  it('renders a responsive multi-select without any raw identifier input', () => {
    const source = readFileSync('src/packages/admin/events/index.ts', 'utf8')
    const view = readFileSync('src/packages/admin/events/index.wxml', 'utf8')

    expect(source).toContain('item.capability === \'events.catalog.manage\'')
    expect(source).toContain('item.scopeType === \'PLATFORM\'')
    expect(source).toContain('item.scopeId === null')
    expect(view).toContain('id="admin-event-tags-editor"')
    expect(view).toContain('class="mt-4 flex flex-wrap gap-2"')
    expect(view).toContain('min-h-[88rpx]')
    expect(view).toContain('aria-role="checkbox"')
    expect(view).toContain('tagState === \'error\'')
    expect(view).toContain('tagState === \'ready\'')
    expect(view).not.toMatch(/(?:标签|tag)[^\n]{0,80}<t-input/i)
    expect(view).not.toContain('placeholder="活动标签 ID"')
  })
})
