import { beforeAll, describe, expect, it, vi } from 'vitest'
import { parseOpportunityCooperators } from '../src/modules/mip-opportunities/validation'

const setCooperation = vi.hoisted(() => vi.fn())
vi.mock('../src/modules/mip-opportunities', () => ({
  opportunityModule: { setCooperation },
  journeyStatusOf: vi.fn(),
  opportunityTypeLabel: vi.fn(),
  retainOpportunityCommentReportIntent: vi.fn(),
  retainOpportunityCommentSubmissionIntent: vi.fn(),
}))
vi.mock('../src/modules/mip-identity', () => ({ mipAccessPageUrl: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: {} }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/mip-opportunities/detail/index')
  vi.unstubAllGlobals()
})
describe('opportunity cooperation intent', () => {
  it('latches a double tap until the server result and refresh complete, then allows cancellation', async () => {
    let resolve!: (value: unknown) => void
    setCooperation.mockReturnValueOnce(new Promise((done) => {
      resolve = done
    })).mockResolvedValueOnce({ active: false, version: 2 })
    vi.stubGlobal('wx', { showToast: vi.fn() })
    const page = Object.assign(Object.create(definition), {
      data: { ...structuredClone(definition.data), item: { id: 'opp', cooperationActive: false } },
      setData(patch: Record<string, unknown>) {
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'item.cooperationActive') {
            this.data.item.cooperationActive = value
          }
          else { this.data[key] = value }
        }
      },
      load: vi.fn().mockResolvedValue(undefined),
    })
    const first = page.performInteraction('cooperation')
    await page.performInteraction('cooperation')
    expect(setCooperation).toHaveBeenCalledTimes(1)
    resolve({ active: true, version: 1 })
    await first
    expect(page.data.item.cooperationActive).toBe(true)
    await page.performInteraction('cooperation')
    expect(setCooperation).toHaveBeenLastCalledWith('opp', false)
    expect(page.data.item.cooperationActive).toBe(false)
    expect(page.data.acting).toBe(false)
    vi.unstubAllGlobals()
  })
  it('validates nonempty public cooperator DTOs and rejects private fields', () => {
    const member = { profileRef: `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`, nickname: '合作伙伴', avatarUrl: 'cloud://avatar', headline: '设计师' }
    expect(parseOpportunityCooperators({ items: [member], nextCursor: 'next' }).items).toEqual([member])
    expect(() => parseOpportunityCooperators({ items: [{ ...member, userId: 'private' }] })).toThrow()
    expect(() => parseOpportunityCooperators({ items: [{ ...member, nickname: 42 }] })).toThrow()
  })
})
