import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveOpportunity } = vi.hoisted(() => ({ saveOpportunity: vi.fn() }))

vi.mock('../src/modules/mip-ai/client', () => ({ mipAiModule: {} }))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-media/client', () => ({ mipMediaModule: {} }))
vi.mock('../src/modules/mip-messaging/client', () => ({ mipMessagingModule: { subscriptionCapability: vi.fn(() => ({ available: false })), requestWechatSubscription: vi.fn() } }))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { save: saveOpportunity },
  journeyStatusOf: (item: { status: string }) => item.status,
  opportunityTypeOptions: [
    { key: 'COMPANY', label: '找企业' },
    { key: 'RESOURCE', label: '找资源' },
    { key: 'PARTNER', label: '找伙伴' },
  ],
  opportunityProjectStatusOptions: [
    { key: 'RECRUITING', label: '招募中', description: '想合作的人将通知你' },
    { key: 'ENDED', label: '结束项目', description: '不再招募' },
    { key: 'UNPUBLISHED', label: '下架项目', description: '仅自己可见' },
  ],
}))
vi.mock('../src/platform/wechat/image-upload', () => ({ chooseSingleImage: vi.fn() }))

type PageData = Record<string, any>
type PageDefinition = Record<string, any> & {
  data: PageData
  setData: (patch: PageData) => void
}

let definition: PageDefinition
const showToast = vi.fn()
const pageScrollTo = vi.fn()

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

function createPage(overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = patch => Object.assign(page.data, patch)
  return page
}

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast, pageScrollTo })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    definition = input
  })
  await import('../src/packages/member/mip-opportunities/editor/index')
})

beforeEach(() => {
  saveOpportunity.mockReset()
  saveOpportunity.mockResolvedValue({ id: 'op-1', status: 'PUBLISHED', version: 2 })
  showToast.mockClear()
  pageScrollTo.mockClear()
})

const detailBase = {
  id: 'op-1',
  title: '品牌合作',
  valueSummary: '',
  targetSummary: '寻找伙伴',
  description: '',
  status: 'DRAFT',
  canEdit: true,
  roles: [],
  typeKeys: [],
  industryTags: [],
  abilityTags: [],
  teamMembers: [],
  version: 4,
  playersOnly: false,
  branchId: null,
}

function termsPayload(callIndex = 0) {
  const input = saveOpportunity.mock.calls[callIndex]?.[0] as PageData
  return input?.commercialTerms
}

describe('MIP opportunity value modes (MIW-89)', () => {
  it('renders the optional label, two mode rows and a fixed qian unit', () => {
    const view = source('src/packages/member/mip-opportunities/editor/index.wxml')
    expect(view).toContain('<text>价值金额（选填）</text>')
    expect(view).toContain('aria-label="价值金额，选填，单位千"')
    expect(view).toContain('面谈')
    expect(view).toContain('具体金额')
    // 金额输入固定「千」单位后缀，输入只允许数字（type=digit）。
    expect(view).toContain('>千</text>')
    expect(view).toContain('type="digit"')
    expect(view).toContain('bindinput="updateValueQian"')
  })

  it('no longer requires the value amount and drops the old required message', () => {
    const script = source('src/packages/member/mip-opportunities/editor/index.ts')
    expect(script).not.toContain('请输入价值金额或价值说明。')
    const page = createPage({ title: '', targetSummary: '' })
    expect(Reflect.apply(page.validateRequiredFields, page, [])).toBe(false)
    expect(page.data.titleError).toBe('请输入机会名称。')
    expect(page.data.valueAmountError).toBe('')
    expect(showToast).toHaveBeenCalledWith({ title: '请输入机会名称。', icon: 'none' })
  })

  it('submits an empty value summary with no terms when nothing is chosen (A1)', async () => {
    const page = createPage({ title: '项目', targetSummary: '寻找合作方' })
    await page.save(true)
    const input = saveOpportunity.mock.calls[0][0] as PageData
    expect(input.valueSummary).toBe('')
    expect(input.commercialTerms).toBeUndefined()
  })

  it('toggles the negotiation mode and submits structured NEGOTIATION terms (A2)', async () => {
    const page = createPage({ title: '项目', targetSummary: '寻找合作方' })
    Reflect.apply(page.chooseValueMode, page, [{ currentTarget: { dataset: { mode: 'NEGOTIATION' } } }])
    expect(page.data.valueMode).toBe('NEGOTIATION')
    // 再点一次取消选择
    Reflect.apply(page.chooseValueMode, page, [{ currentTarget: { dataset: { mode: 'NEGOTIATION' } } }])
    expect(page.data.valueMode).toBe('')

    Reflect.apply(page.chooseValueMode, page, [{ currentTarget: { dataset: { mode: 'NEGOTIATION' } } }])
    await page.save(true)
    expect(termsPayload()).toEqual({
      currency: 'CNY',
      amountUnit: 'CNY_CENTS',
      valueMode: 'NEGOTIATION',
      minAmountCents: null,
      maxAmountCents: null,
      locations: [],
    })
  })

  it('submits a qian single amount converted to cents (A3)', async () => {
    const page = createPage({ title: '项目', targetSummary: '寻找合作方' })
    Reflect.apply(page.chooseValueMode, page, [{ currentTarget: { dataset: { mode: 'AMOUNT' } } }])
    Reflect.apply(page.updateValueQian, page, [{ detail: { value: '5' } }])
    expect(page.data.valueMode).toBe('AMOUNT')
    expect(page.data.valueQian).toBe('5')
    await page.save(true)
    expect(termsPayload()).toEqual({
      currency: 'CNY',
      amountUnit: 'CNY_CENTS',
      valueMode: 'SINGLE',
      minAmountCents: 500000,
      maxAmountCents: 500000,
      locations: [],
    })
  })

  it('blocks the save with a unit error when the amount is empty or malformed (A4)', async () => {
    for (const valueQian of ['', 'abc', '0', '-5', '5.55']) {
      const page = createPage({ title: '项目', targetSummary: '寻找合作方', valueMode: 'AMOUNT', valueQian })
      saveOpportunity.mockClear()
      await page.save(true)
      expect(saveOpportunity).not.toHaveBeenCalled()
      expect(page.data.valueAmountError).toBe('请输入正确的价值金额（单位：千）。')
      expect(pageScrollTo).toHaveBeenCalledWith({ selector: '#opportunity-field-value-summary', duration: 200 })
    }
    // 一位小数与上限值合法（99999999.9 千）
    const page = createPage({ title: '项目', targetSummary: '寻找合作方', valueMode: 'AMOUNT', valueQian: '5.5' })
    await page.save(true)
    expect(termsPayload()).toMatchObject({ valueMode: 'SINGLE', minAmountCents: 550000 })
    saveOpportunity.mockClear()
    saveOpportunity.mockResolvedValue({ id: 'op-1', status: 'PUBLISHED', version: 2 })
    const maxPage = createPage({ title: '项目', targetSummary: '寻找合作方', valueMode: 'AMOUNT', valueQian: '99999999.9' })
    await maxPage.save(true)
    expect(termsPayload()).toMatchObject({ valueMode: 'SINGLE', minAmountCents: 9999999990000 })
  })

  it('carries legacy RANGE terms and legacy value text back untouched on edit (A5)', async () => {
    const page = createPage()
    Reflect.apply(page.applyCatalog, page, [{ cityTags: [] }, {
      ...detailBase,
      valueSummary: '资源互换',
      commercialTerms: {
        currency: 'CNY',
        amountUnit: 'CNY_CENTS',
        valueMode: 'RANGE',
        minAmountCents: 660000,
        maxAmountCents: 1880000,
        locations: [],
      },
    }])
    expect(page.data.valueMode).toBe('')
    expect(page.data.valueSummary).toBe('资源互换')
    await page.save(true)
    const input = saveOpportunity.mock.calls[0][0] as PageData
    expect(input.valueSummary).toBe('资源互换')
    expect(input.commercialTerms).toEqual({
      currency: 'CNY',
      amountUnit: 'CNY_CENTS',
      valueMode: 'RANGE',
      minAmountCents: 660000,
      maxAmountCents: 1880000,
      locations: [],
    })
  })

  it('maps SINGLE and NEGOTIATION details back into the mode rows', () => {
    const page = createPage()
    Reflect.apply(page.applyCatalog, page, [{ cityTags: [] }, {
      ...detailBase,
      commercialTerms: {
        currency: 'CNY',
        amountUnit: 'CNY_CENTS',
        valueMode: 'SINGLE',
        minAmountCents: 550000,
        maxAmountCents: 550000,
        locations: [],
      },
    }])
    expect(page.data.valueMode).toBe('AMOUNT')
    expect(page.data.valueQian).toBe('5.5')

    const negotiation = createPage()
    Reflect.apply(negotiation.applyCatalog, negotiation, [{ cityTags: [] }, {
      ...detailBase,
      commercialTerms: {
        currency: 'CNY',
        amountUnit: 'CNY_CENTS',
        valueMode: 'NEGOTIATION',
        minAmountCents: null,
        maxAmountCents: null,
        locations: [],
      },
    }])
    expect(negotiation.data.valueMode).toBe('NEGOTIATION')
  })

  it('sends explicit null terms when the user unselects a mode on an opportunity that had terms', async () => {
    const page = createPage()
    Reflect.apply(page.applyCatalog, page, [{ cityTags: [] }, {
      ...detailBase,
      commercialTerms: {
        currency: 'CNY',
        amountUnit: 'CNY_CENTS',
        valueMode: 'NEGOTIATION',
        minAmountCents: null,
        maxAmountCents: null,
        locations: [],
      },
    }])
    Reflect.apply(page.chooseValueMode, page, [{ currentTarget: { dataset: { mode: 'NEGOTIATION' } } }])
    expect(page.data.valueMode).toBe('')
    await page.save(true)
    expect(termsPayload()).toBeNull()
  })

  it('fills the mode rows from pasted or AI value text (OPPVAL-05)', () => {
    const page = createPage()
    Reflect.apply(page.applyPastedDraft, page, [{ title: '项目', valueSummary: '合作金额面议', targetSummary: '寻找合作方' }])
    expect(page.data.valueMode).toBe('NEGOTIATION')
    // 未识别的价值文本不再塞回表单（新 UI 无该输入），存量编辑时原值带回由 save 承担。
    const unclear = createPage()
    Reflect.apply(unclear.applyPastedDraft, unclear, [{ title: '项目', valueSummary: '期权谈话', targetSummary: '寻找合作方' }])
    expect(unclear.data.valueMode).toBe('')
    expect(unclear.data.valueQian).toBe('')

    const amount = createPage()
    Reflect.apply(amount.applyPastedDraft, amount, [{ title: '项目', valueSummary: '预算50万', targetSummary: '寻找合作方' }])
    expect(amount.data.valueMode).toBe('AMOUNT')
    expect(amount.data.valueQian).toBe('500')
  })
})
