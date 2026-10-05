import { describe, expect, it } from 'vitest'
import {
  createEmptyGuideRecord,
  evaluateSubscriptionGuide,
  GUIDE_PENDING_STORAGE_KEY,
  GUIDE_PENDING_TTL_MS,
  GUIDE_RECORD_LIMIT,
  GUIDE_REJECTION_CAP,
  GUIDE_SHOWN_INTERVAL_MS,
  normalizeGuideRecord,
  readPendingGuideOpportunity,
  recordGuideDecision,
  recordGuideShown,
  writePendingGuideOpportunity,
} from '../src/modules/mip-messaging/guide-policy'

const DAY = GUIDE_SHOWN_INTERVAL_MS

function input(now: number, overrides: Record<string, unknown> = {}) {
  return {
    templateKey: 'OPPORTUNITY_NOTICE',
    opportunityId: 'opp-1',
    now,
    capabilityAvailable: true,
    ...overrides,
  } as Parameters<typeof evaluateSubscriptionGuide>[1]
}

describe('subscription guide policy', () => {
  it('stays hidden while the template is missing or the opportunity is unknown', () => {
    const record = createEmptyGuideRecord()
    expect(evaluateSubscriptionGuide(record, input(0, { capabilityAvailable: false })))
      .toEqual({ presentation: 'HIDDEN', reason: 'TEMPLATE_MISSING' })
    expect(evaluateSubscriptionGuide(record, input(0, { opportunityId: ' ' })))
      .toEqual({ presentation: 'HIDDEN', reason: 'TEMPLATE_MISSING' })
  })

  it('shows the request layer at most once per opportunity per day (D2)', () => {
    const now = 1_000_000
    const record = recordGuideShown(createEmptyGuideRecord(), 'opp-1', now)
    expect(evaluateSubscriptionGuide(record, input(now))).toEqual({ presentation: 'HIDDEN', reason: 'SHOWN_RECENTLY' })
    expect(evaluateSubscriptionGuide(record, input(now + DAY - 1)).reason).toBe('SHOWN_RECENTLY')
    // 另一个机会不受影响：24h 按机会维度计
    expect(evaluateSubscriptionGuide(record, input(now, { opportunityId: 'opp-2' })))
      .toEqual({ presentation: 'REQUEST', reason: 'ELIGIBLE' })
    expect(evaluateSubscriptionGuide(record, input(now + DAY))).toEqual({ presentation: 'REQUEST', reason: 'ELIGIBLE' })
  })

  it('switches to manual-only guidance after a rejection (S5, D4)', () => {
    const now = 1_000_000
    let record = recordGuideShown(createEmptyGuideRecord(), 'opp-1', now)
    record = recordGuideDecision(record, 'OPPORTUNITY_NOTICE', 'REJECTED')
    expect(record.rejectedCountByTemplate.OPPORTUNITY_NOTICE).toBe(1)
    // 拒绝过就不再拉原生面板：跨天重新 eligible 也只保留手动开启文案
    expect(evaluateSubscriptionGuide(record, input(now + DAY)))
      .toEqual({ presentation: 'MANUAL', reason: 'REJECTED' })
    expect(evaluateSubscriptionGuide(record, input(now + DAY, { opportunityId: 'opp-2' })).presentation).toBe('MANUAL')
    // 其它模板键互不影响
    expect(evaluateSubscriptionGuide(record, input(now + DAY, { templateKey: 'EVENT_REMINDER' })))
      .toEqual({ presentation: 'REQUEST', reason: 'ELIGIBLE' })
  })

  it('hides permanently after the rejection cap or a terminal decision (D2/S4/S6)', () => {
    let record = createEmptyGuideRecord()
    for (let count = 0; count < GUIDE_REJECTION_CAP; count += 1) {
      record = recordGuideDecision(record, 'OPPORTUNITY_NOTICE', 'REJECTED')
    }
    // 封顶后累加不再增长
    record = recordGuideDecision(record, 'OPPORTUNITY_NOTICE', 'REJECTED')
    expect(record.rejectedCountByTemplate.OPPORTUNITY_NOTICE).toBe(GUIDE_REJECTION_CAP)
    expect(evaluateSubscriptionGuide(record, input(0))).toEqual({ presentation: 'HIDDEN', reason: 'REJECTION_CAP' })

    expect(evaluateSubscriptionGuide(
      recordGuideDecision(createEmptyGuideRecord(), 'OPPORTUNITY_NOTICE', 'ACCEPTED'),
      input(0),
    )).toEqual({ presentation: 'HIDDEN', reason: 'ACCEPTED' })
    expect(evaluateSubscriptionGuide(
      recordGuideDecision(createEmptyGuideRecord(), 'OPPORTUNITY_NOTICE', 'BANNED'),
      input(0),
    )).toEqual({ presentation: 'HIDDEN', reason: 'BANNED' })
  })

  it('keeps the shown cadence scoped per opportunity while counting rejections per template', () => {
    const now = 1_000_000
    let record = recordGuideShown(createEmptyGuideRecord(), 'opp-1', now)
    record = recordGuideDecision(record, 'OPPORTUNITY_NOTICE', 'REJECTED')
    expect(evaluateSubscriptionGuide(record, input(now, { opportunityId: 'opp-2' }))).toEqual({
      presentation: 'MANUAL',
      reason: 'REJECTED',
    })
  })

  it('sanitizes persisted records and keeps bounded entries', () => {
    expect(normalizeGuideRecord(undefined)).toEqual(createEmptyGuideRecord())
    expect(normalizeGuideRecord('junk')).toEqual(createEmptyGuideRecord())
    expect(normalizeGuideRecord([])).toEqual(createEmptyGuideRecord())
    const record = normalizeGuideRecord({
      shownAtByOpportunity: { 'opp-1': 10, 'bad': 'x', 'negative': -5 },
      rejectedCountByTemplate: { OPPORTUNITY_NOTICE: 2, OTHER: 'x' },
      decidedTemplates: { OPPORTUNITY_NOTICE: 'BANNED', OTHER: 'REJECTED' },
    })
    expect(record.shownAtByOpportunity).toEqual({ 'opp-1': 10 })
    expect(record.rejectedCountByTemplate).toEqual({ OPPORTUNITY_NOTICE: 2 })
    expect(record.decidedTemplates).toEqual({ OPPORTUNITY_NOTICE: 'BANNED' })

    let populated = createEmptyGuideRecord()
    for (let index = 0; index < GUIDE_RECORD_LIMIT + 10; index += 1) {
      populated = recordGuideShown(populated, `opp-${index}`, index)
    }
    expect(Object.keys(populated.shownAtByOpportunity)).toHaveLength(GUIDE_RECORD_LIMIT)
    expect(populated.shownAtByOpportunity[`opp-${GUIDE_RECORD_LIMIT + 9}`]).toBe(GUIDE_RECORD_LIMIT + 9)
    expect(populated.shownAtByOpportunity['opp-0']).toBeUndefined()
  })

  it('ignores empty opportunity or template keys when recording', () => {
    const record = createEmptyGuideRecord()
    expect(recordGuideShown(record, ' ', 1)).toBe(record)
    expect(recordGuideDecision(record, ' ', 'REJECTED')).toBe(record)
  })

  it('writes and consumes a publish pending within its TTL (S8)', () => {
    const now = 1_000_000
    const raw = writePendingGuideOpportunity(' opp-9 ', now)
    expect(JSON.parse(raw)).toEqual({ id: 'opp-9', at: now })
    expect(readPendingGuideOpportunity(raw, now + GUIDE_PENDING_TTL_MS)).toBe('opp-9')
    // TTL 之外、时钟回拨、坏形状都不产生 pending
    expect(readPendingGuideOpportunity(raw, now + GUIDE_PENDING_TTL_MS + 1)).toBe('')
    expect(readPendingGuideOpportunity(raw, now - 1)).toBe('')
    expect(readPendingGuideOpportunity('junk', now)).toBe('')
    expect(readPendingGuideOpportunity(undefined, now)).toBe('')
    expect(readPendingGuideOpportunity(JSON.stringify({ id: 'opp-9' }), now)).toBe('')
    expect(readPendingGuideOpportunity(JSON.stringify({ id: 'opp-9', at: 'x' }), now)).toBe('')
    expect(readPendingGuideOpportunity(GUIDE_PENDING_STORAGE_KEY, now)).toBe('')
  })

  it('rejects invalid opportunity ids when writing a publish pending', () => {
    const now = 1_000_000
    expect(writePendingGuideOpportunity(' ', now)).toBe('')
    expect(writePendingGuideOpportunity('x'.repeat(65), now)).toBe('')
    expect(readPendingGuideOpportunity(writePendingGuideOpportunity('x'.repeat(64), now), now)).toBe('x'.repeat(64))
  })
})
