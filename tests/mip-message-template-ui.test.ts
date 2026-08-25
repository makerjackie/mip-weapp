import type {
  AdminMessageCampaign,
  AdminMessageTemplate,
} from '../src/modules/mip-admin'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

type PageData = Record<string, unknown>
type PageDefinition = PageData & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
let adminApi: typeof import('../src/modules/mip-admin')

const showModal = vi.fn(async () => ({ confirm: true, cancel: false }))
const showToast = vi.fn()

function record(value: unknown): value is PageData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setPath(target: PageData, path: string, value: unknown) {
  const parts = path.split('.')
  const leaf = parts.pop()
  if (!leaf) {
    return
  }
  let cursor = target
  for (const part of parts) {
    if (!record(cursor[part])) {
      cursor[part] = {}
    }
    cursor = cursor[part] as PageData
  }
  cursor[leaf] = value
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      setPath(page.data, path, value)
    }
  }
  return page
}

function callPage(page: PageDefinition, method: string, ...args: unknown[]) {
  const handler = page[method]
  if (typeof handler !== 'function') {
    throw new TypeError(`Missing page method: ${method}`)
  }
  return Reflect.apply(handler, page, args) as unknown
}

function touch(dataset: PageData) {
  return { currentTarget: { dataset } } as unknown as WechatMiniprogram.TouchEvent
}

const emptyStageStats = {
  pendingCount: 0,
  processingCount: 0,
  retryingCount: 0,
  deliveredCount: 0,
  terminalCount: 0,
}

function campaign(overrides: Partial<AdminMessageCampaign> = {}): AdminMessageCampaign {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    scopeType: 'PLATFORM',
    branchId: null,
    branchName: '',
    audienceType: 'ALL',
    recipientRefs: [],
    name: '九月活动提醒',
    title: '活动安排已更新',
    body: '请在活动页查看最新安排。',
    status: 'DRAFT',
    contentSafetyStatus: 'PASSED',
    recipientCount: 0,
    deliveryStats: {
      submittedCount: 0,
      inboxReadyCount: 0,
      failedCount: 0,
      outboxStats: emptyStageStats,
      externalTaskStats: emptyStageStats,
    },
    snapshotAt: null,
    publishedAt: null,
    withdrawnAt: null,
    version: 3,
    updatedAt: '2030-09-01T08:00:00.000Z',
    ...overrides,
  }
}

function template(overrides: Partial<AdminMessageTemplate> = {}): AdminMessageTemplate {
  return {
    id: '20000000-0000-4000-8000-000000000002',
    scopeType: 'PLATFORM',
    branchId: null,
    branchName: '',
    status: 'ACTIVE',
    currentRevisionNumber: 2,
    name: '活动提醒',
    title: '活动即将开始',
    body: '请在活动页查看最新安排。',
    contentSafetyStatus: 'PASSED',
    revisionCreatedAt: '2030-08-24T08:00:00.000Z',
    version: 4,
    createdAt: '2030-08-20T08:00:00.000Z',
    updatedAt: '2030-08-24T08:00:00.000Z',
    ...overrides,
  }
}

function templateChoice(item: AdminMessageTemplate) {
  return {
    ...item,
    statusText: item.status === 'ACTIVE' ? '启用' : item.status === 'DRAFT' ? '草稿' : '归档',
    safetyText: '已通过',
    scopeText: item.scopeType === 'PLATFORM' ? '全平台' : item.branchName,
    updatedText: '2030/08/24 16:00',
  }
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    showModal,
    showToast,
    stopPullDownRefresh: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  adminApi = await import('../src/modules/mip-admin')
  await import('../src/packages/admin/message-campaigns/index')
})

afterEach(() => {
  vi.restoreAllMocks()
  showModal.mockReset()
  showModal.mockResolvedValue({ confirm: true, cancel: false })
  showToast.mockClear()
})

describe('MIP message template admin UI', () => {
  it('switches between message campaigns and templates and keeps both source entries explicit', () => {
    const page = createPage({
      section: 'campaigns',
      templateMode: 'list',
      templateState: 'ready',
      templateItems: [templateChoice(template())],
    })

    callPage(page, 'chooseSection', touch({ section: 'templates' }))
    expect(page.data.section).toBe('templates')
    callPage(page, 'chooseSection', touch({ section: 'campaigns' }))
    expect(page.data.section).toBe('campaigns')

    const markup = readFileSync('src/packages/admin/message-campaigns/index.wxml', 'utf8')
    const source = readFileSync('src/packages/admin/message-campaigns/index.ts', 'utf8')
    expect(markup).toContain('data-section="campaigns"')
    expect(markup).toContain('data-section="templates"')
    expect(markup).toContain('消息活动')
    expect(markup).toContain('消息模板')
    expect(markup).toContain('mip-admin-form-grid')
    expect(markup).toContain('mip-admin-section-grid')
    expect(source).toContain('mipAdminModule.messaging.listTemplates')
    expect(source).toContain('mipAdminModule.messaging.getTemplate')
    expect(source).toContain('mipAdminModule.messaging.saveTemplate')
  })

  it('loads filtered templates and selected current revisions through the messaging facade', async () => {
    const current = template()
    const listTemplates = vi.spyOn(adminApi.mipAdminModule.messaging, 'listTemplates')
      .mockResolvedValue({ items: [current], nextCursor: null })
    const getTemplate = vi.spyOn(adminApi.mipAdminModule.messaging, 'getTemplate')
      .mockResolvedValue(current)
    const page = createPage({ templateStatusFilter: 'ACTIVE', templateItems: [] })
    page.loadBase = vi.fn(async () => ({ platform: true, branches: [] }))

    await callPage(page, 'loadTemplateList', true)
    expect(listTemplates).toHaveBeenCalledWith({ status: 'ACTIVE' }, true)
    expect(page.data.templateState).toBe('ready')
    await callPage(page, 'openTemplateById', current.id, true)
    expect(getTemplate).toHaveBeenCalledWith(current.id, true)
    expect(page.data.templateRevisionNumber).toBe(current.currentRevisionNumber)
  })

  it('copies only title and body into a campaign and never submits templateId', async () => {
    const active = templateChoice(template())
    const saveCampaign = vi.spyOn(adminApi.mipAdminModule.messaging, 'saveCampaign')
      .mockResolvedValue(campaign({ title: active.title, body: active.body }))
    const page = createPage({
      editable: true,
      campaignId: '',
      processing: '',
      campaignTemplateOptions: [active],
      draft: {
        scopeType: 'PLATFORM',
        branchId: null,
        audienceType: 'EXPLICIT',
        recipientRefs: ['p1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccc'],
        name: '运营识别名称',
        title: '原标题',
        body: '原正文',
      },
    })

    callPage(page, 'applyCampaignTemplate', touch({ id: active.id }))
    const copiedDraft = page.data.draft as PageData
    expect(copiedDraft).toMatchObject({
      name: '运营识别名称',
      scopeType: 'PLATFORM',
      audienceType: 'EXPLICIT',
      title: active.title,
      body: active.body,
    })
    expect(page.data.templateCopyNotice).toContain('后续修改不会影响')

    await callPage(page, 'saveDraft')
    const submitted = saveCampaign.mock.calls[0]?.[0]
    expect(submitted).toMatchObject({
      name: '运营识别名称',
      scopeType: 'PLATFORM',
      audienceType: 'EXPLICIT',
      title: active.title,
      body: active.body,
    })
    expect(submitted).not.toHaveProperty('templateId')
  })

  it('keeps copied content while clearing an incompatible branch template selection', () => {
    const branchA = '30000000-0000-4000-8000-000000000001'
    const branchB = '30000000-0000-4000-8000-000000000002'
    const platform = templateChoice(template())
    const branchTemplate = templateChoice(template({
      id: '20000000-0000-4000-8000-000000000003',
      scopeType: 'BRANCH',
      branchId: branchA,
      branchName: '深圳分会',
    }))
    const page = createPage({
      selectedTemplateId: branchTemplate.id,
      campaignTemplatePool: [platform, branchTemplate],
      draft: {
        scopeType: 'BRANCH',
        branchId: branchA,
        audienceType: 'ALL',
        recipientRefs: [],
        name: '活动提醒',
        title: branchTemplate.title,
        body: branchTemplate.body,
      },
    })

    callPage(page, 'syncCampaignTemplateOptions', 'BRANCH', branchB)

    const options = page.data.campaignTemplateOptions as AdminMessageTemplate[]
    expect(options.map(item => item.id)).toEqual([platform.id])
    expect(page.data.selectedTemplateId).toBe('')
    expect(page.data.templateCopyNotice).toContain('已复制的消息标题和正文保持不变')
    expect(page.data.draft).toMatchObject({
      title: branchTemplate.title,
      body: branchTemplate.body,
    })
  })

  it('confirms ACTIVE edits and saves a new DRAFT revision with the current version', async () => {
    const current = template()
    const saveTemplate = vi.spyOn(adminApi.mipAdminModule.messaging, 'saveTemplate')
      .mockResolvedValue(template({
        status: 'DRAFT',
        currentRevisionNumber: 3,
        version: 5,
      }))
    const page = createPage({
      templateEditable: true,
      templateProcessing: '',
      templateId: current.id,
      templateVersion: current.version,
      templateStatus: 'ACTIVE',
      templateDraft: {
        scopeType: current.scopeType,
        branchId: current.branchId,
        name: current.name,
        title: '修改后的标题',
        body: current.body,
      },
    })

    showModal.mockResolvedValueOnce({ confirm: false, cancel: true })
    await callPage(page, 'saveTemplateDraft')
    expect(saveTemplate).not.toHaveBeenCalled()

    showModal.mockResolvedValueOnce({ confirm: true, cancel: false })
    await callPage(page, 'saveTemplateDraft')
    expect(showModal.mock.calls[1]?.[0]).toMatchObject({
      title: '保存模板新版本',
      content: expect.stringContaining('重新通过内容检查后启用'),
    })
    expect(saveTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateId: current.id,
      expectedVersion: current.version,
      title: '修改后的标题',
    }))
    expect(page.data.templateStatus).toBe('DRAFT')
    expect(page.data.templateVersion).toBe(5)
  })

  it('uses expectedVersion for activate and archive and exposes conflicts for reload', async () => {
    const draft = template({ status: 'DRAFT' })
    const activateTemplate = vi.spyOn(adminApi.mipAdminModule.messaging, 'activateTemplate')
      .mockResolvedValue(template({ status: 'ACTIVE', version: 5 }))
    const archiveTemplate = vi.spyOn(adminApi.mipAdminModule.messaging, 'archiveTemplate')
      .mockResolvedValue(template({ status: 'ARCHIVED', version: 6 }))
    const page = createPage({
      templateId: draft.id,
      templateVersion: draft.version,
      templateStatus: 'DRAFT',
      templateSafetyStatus: 'PASSED',
      templateProcessing: '',
    })

    await callPage(page, 'activateTemplate')
    expect(activateTemplate).toHaveBeenCalledWith(draft.id, 4)
    await callPage(page, 'archiveTemplate')
    expect(archiveTemplate).toHaveBeenCalledWith(draft.id, 5)

    callPage(
      page,
      'handleTemplateMutationFailure',
      new adminApi.MipAdminError('CONFLICT', '模板已被其他管理员更新'),
      '模板更新失败',
    )
    expect(page.data.templateState).toBe('conflict')
    expect(page.data.templateMessage).toContain('重新加载')
  })
})
