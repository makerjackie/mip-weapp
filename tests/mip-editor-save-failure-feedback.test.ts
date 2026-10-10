import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { saveSuperCase, saveCooperation } = vi.hoisted(() => ({
  saveSuperCase: vi.fn(),
  saveCooperation: vi.fn(),
}))

vi.mock('../src/modules/mip-ai/editor', () => ({
  aiText: (fields: Record<string, unknown>, key: string) => fields?.[key] ?? '',
  aiObject: (fields: Record<string, unknown>, key: string) => (fields?.[key] ?? {}) as Record<string, unknown>,
}))
vi.mock('../src/modules/mip-ai/editor-loader', () => ({ loadAiEditorDraft: vi.fn() }))
vi.mock('../src/modules/mip-cases', () => ({
  superCaseModule: { get: vi.fn(), save: saveSuperCase },
}))
vi.mock('../src/modules/mip-cooperation', () => ({
  cooperationModule: { get: vi.fn(), save: saveCooperation },
  normalizeCooperationCircles: (value: unknown) => value,
  normalizeCooperationQuirks: (value: unknown) => value,
}))
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { getCatalogs: vi.fn() },
}))

type PageData = Record<string, any>
type PageDefinition = Record<string, any> & {
  data: PageData
  setData: (patch: PageData) => void
}

// 两个编辑器页面按 import 顺序落位（MIP-3：三编辑器保存失败反馈补齐）。
let caseDefinition: PageDefinition
let cooperationDefinition: PageDefinition

// 与真实 setData 一致地解析 'projects[0].projectName' 这类路径键
function assignPath(target: PageData, key: string, value: unknown) {
  const tokens = key.match(/([^[.\]])+/g) || []
  let cursor: PageData = target
  for (const token of tokens.slice(0, -1)) {
    cursor = Array.isArray(cursor) ? cursor[Number(token)] : cursor[token]
  }
  const last = tokens[tokens.length - 1] ?? ''
  if (Array.isArray(cursor)) {
    cursor[Number(last)] = value
  }
  else {
    cursor[last] = value
  }
}

function createPage(definition: PageDefinition, overrides: PageData = {}) {
  const page = Object.create(definition) as PageDefinition
  page.data = { ...structuredClone(definition.data), ...structuredClone(overrides) }
  page.setData = (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      assignPath(page.data, key, value)
    }
  }
  return page
}

function casePage() {
  return createPage(caseDefinition, {
    state: 'ready',
    projects: [{
      projectName: 'MIP 全球创意人平台',
      summary: '千万超级个体生意写作社群',
      startedOn: '2026-01-01',
      responsibility: 'MIP 团队管理',
      cityLabel: '深圳',
      cityTagId: 'city-shenzhen',
      region: '总部在深圳',
      caseType: '广告策划',
      description: '',
    }],
  })
}

function cooperationPage() {
  return createPage(cooperationDefinition, {
    state: 'ready',
    goals: [{ key: 'targetSummary', label: '合作目标', placeholder: '', value: '' }],
  })
}

beforeAll(async () => {
  vi.stubGlobal('wx', {
    showToast: vi.fn(),
    enableAlertBeforeUnload: vi.fn(),
    disableAlertBeforeUnload: vi.fn(),
  })
  vi.stubGlobal('Page', (input: PageDefinition) => {
    if (!caseDefinition) {
      caseDefinition = input
    }
    else {
      cooperationDefinition = input
    }
  })
  await import('../src/packages/member/mip-cases/editor/index')
  await import('../src/packages/member/mip-cooperation/editor/index')
})

beforeEach(() => {
  saveSuperCase.mockReset()
  saveCooperation.mockReset()
})

describe('MIP super case editor save-failure feedback (MIP-3)', () => {
  it('keeps the failure message and a clickable button until fields change', async () => {
    const page = casePage()
    const error = new Error('提交内容格式不正确，请检查后重试')
    saveSuperCase.mockRejectedValueOnce(error)

    await Reflect.apply(page.save, page, [])

    expect(saveSuperCase).toHaveBeenCalledTimes(1)
    // 持久横幅数据保持，不自动消失；主按钮 loading 复位可再次点击
    expect(page.data.message).toBe(error.message)
    expect(page.data.saving).toBe(false)
    expect(page.navigationTimer).toBeUndefined()

    // 修改任一字段后清除
    Reflect.apply(page.updateProjectText, page, [{
      currentTarget: { dataset: { groupIndex: 0, field: 'projectName' } },
      detail: { value: '改名后的项目' },
    }])
    expect(page.data.message).toBe('')
    expect(page.data.projects[0].projectName).toBe('改名后的项目')
  })

  it('clears the stale banner when the next save starts and can show a fresh failure', async () => {
    const page = casePage()
    const error = new Error('提交内容格式不正确，请检查后重试')
    saveSuperCase.mockRejectedValueOnce(error)
    await Reflect.apply(page.save, page, [])
    expect(page.data.message).toBe(error.message)

    saveSuperCase.mockRejectedValueOnce(error)
    await Reflect.apply(page.save, page, [])

    expect(saveSuperCase).toHaveBeenCalledTimes(2)
    expect(page.data.saving).toBe(false)
    expect(page.data.message).toBe(error.message)
  })

  it('keeps the failure banner out of the success path wiring', () => {
    // 成功路径不变：toast + 定时返回；失败路径不触碰导航
    expect(caseDefinition.data).toHaveProperty('message')
    expect(caseDefinition).toHaveProperty('dismissSaveError')
  })
})

describe('MIP cooperation editor save-failure feedback (MIP-3)', () => {
  it('keeps the failure message and a clickable button until fields change', async () => {
    const page = cooperationPage()
    const error = new Error('合作目标需为 1 至 500 个字符')
    saveCooperation.mockRejectedValueOnce(error)

    await Reflect.apply(page.save, page, [])

    expect(saveCooperation).toHaveBeenCalledTimes(1)
    expect(page.data.message).toBe(error.message)
    expect(page.data.saving).toBe(false)
    expect(page.navigationTimer).toBeUndefined()

    // 修改任一字段（touch 统一入口）后清除，返回守卫照常武装
    Reflect.apply(page.updateGoal, page, [{
      currentTarget: { dataset: { key: 'targetSummary' } },
      detail: { value: '寻找渠道合作方' },
    }])
    expect(page.data.message).toBe('')
    expect(page.data.goals[0].value).toBe('寻找渠道合作方')
    expect(page.dirty).toBe(true)
  })

  it('clears the stale banner when the next save starts and can show a fresh failure', async () => {
    const page = cooperationPage()
    const error = new Error('合作目标需为 1 至 500 个字符')
    saveCooperation.mockRejectedValueOnce(error)
    await Reflect.apply(page.save, page, [])
    expect(page.data.message).toBe(error.message)

    saveCooperation.mockRejectedValueOnce(error)
    await Reflect.apply(page.save, page, [])

    expect(saveCooperation).toHaveBeenCalledTimes(2)
    expect(page.data.saving).toBe(false)
    expect(page.data.message).toBe(error.message)
  })

  it('dismisses the banner from the shared touch entry on any field edit', () => {
    const page = cooperationPage()
    page.data.message = '合作目标需为 1 至 500 个字符'

    Reflect.apply(page.touch, page, [])

    expect(page.data.message).toBe('')
  })
})
