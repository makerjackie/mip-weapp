import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP free event vertical contract', () => {
  it('keeps city and title search connected to the event detail route', () => {
    const feed = read('src/pages/events/index.ts')
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')

    expect(feed).toContain('cityName: this.data.selectedCity || undefined')
    expect(feed).toContain('query: this.data.activeQuery || undefined')
    expect(feed).toContain('/packages/member/mip-events/detail/index?eventId=')
    expect(service).toContain('clauses.push(\'e.city_name = ?\')')
    expect(service).toMatch(/clauses\.push\('e\.title LIKE \? ESCAPE/)
  })

  it('preserves the event and check-in intent across access completion and registration retry', () => {
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')

    expect(detail).toContain('? \'&resumeCheckIn=1\'')
    expect(detail).toContain('/packages/member/mip-events/registration/index?eventId=')
    expect(registration).toContain('resume?.action === \'REGISTER_EVENT\'')
    expect(registration).toContain('if (!this.submissionIdempotencyKey)')
    expect(registration).toContain('action: \'REGISTER_EVENT\'')
    expect(registration).toContain('eventId: this.data.eventId')
    expect(registration).toContain('...(this.data.resumeCheckIn ? { resumeCheckIn: \'1\' } : {})')
    expect(registration).toContain('idempotencyKey: this.submissionIdempotencyKey')
  })

  it('routes payment only from a server PAYMENT_REQUIRED outcome', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const paymentBranchStart = registration.indexOf('if (result.kind === \'PAYMENT_REQUIRED\')')
    const freeBranchStart = registration.indexOf('\n      else {', paymentBranchStart)
    const paymentBranch = registration.slice(paymentBranchStart, freeBranchStart)
    const freeBranch = registration.slice(freeBranchStart, registration.indexOf('\n    }\n    catch', freeBranchStart))

    expect(paymentBranchStart).toBeGreaterThan(-1)
    expect(paymentBranch).toContain('mipCommerceModule.payOrder(result.orderId)')
    expect(freeBranch).toContain('result.kind === \'REGISTERED\'')
    expect(freeBranch).not.toContain('payOrder(')
    expect(registration).not.toMatch(/amountCents\s*:/)
  })

  it('restores a signed check-in intent and keeps attended events reachable through detail', () => {
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const checkIn = read('src/packages/member/mip-events/check-in/index.ts')
    const mine = read('src/packages/member/mip-events/mine/index.ts')

    expect(detail).toContain('mipCheckInResumeStore.save(resolved)')
    expect(checkIn).toContain('mipEventsModule.resolveCheckInScene(this.scanToken)')
    expect(checkIn).toContain('mipCheckInResumeStore.clear(String(result.eventId))')
    expect(checkIn).toContain('error.code === \'REGISTRATION_REQUIRED\'')
    expect(checkIn).toContain('error.code === \'REGISTRATION_PENDING\'')
    expect(registration).toContain('result.kind === \'REGISTERED\' && this.data.resumeCheckIn')
    expect(mine).toContain('activeCategory: \'UPCOMING\' as MyRegistrationCategory')
    expect(mine).toContain('/packages/member/mip-events/detail/index?eventId=')
    expect(mine).not.toContain('/packages/member/mip-events/interaction/index?eventId=')
  })

  it('rechecks full access for participation mutations and refreshes optimistic conflicts', () => {
    const handler = read('cloudfunctions/mip-events-api/index.js')
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const interaction = read('src/packages/member/mip-events/interaction/index.ts')
    const feedback = read('src/packages/member/mip-events/feedback/index.ts')

    expect(handler.match(/participationAccessPolicy,/g)?.length).toBeGreaterThanOrEqual(4)
    expect(service).toContain('await requireCurrentParticipationAccess(participationAccessPolicy, tx, appId, userId)')
    expect(interaction).toContain('consumePendingResume(\'packages/member/mip-events/interaction/index\')')
    expect(interaction).toContain('action: \'INTERACT\'')
    expect(interaction).toContain('error.code === \'CONFLICT\'')
    expect(interaction).toContain('mipEventsModule.listHeartCandidates(this.data.eventId)')
    expect(feedback).toContain('consumePendingResume(PAGE_ROUTE)')
    expect(feedback).toContain('action: \'INTERACT\'')
    expect(feedback).toContain('error.code === \'CONFLICT\'')
    expect(feedback).toContain('mipEventsModule.getFeedback(this.data.eventId)')
    expect(feedback).toContain('当前填写内容已保留，请确认后重新保存')
  })

  it('keeps visible loading, empty, error, blocked and disabled states in the journey', () => {
    const views = [
      read('src/pages/events/index.wxml'),
      read('src/packages/member/mip-events/detail/index.wxml'),
      read('src/packages/member/mip-events/registration/index.wxml'),
      read('src/packages/member/mip-events/mine/index.wxml'),
      read('src/packages/member/mip-events/interaction/index.wxml'),
      read('src/packages/member/mip-events/feedback/index.wxml'),
    ].join('\n')

    expect(views).toContain('state === \'loading\'')
    expect(views).toContain('state === \'error\'')
    expect(views).toContain('暂无活动')
    expect(views).toContain('state === \'blocked\'')
    expect(views).toContain('aria-disabled="{{primaryAction === \'disabled\' || busy}}"')
  })
})
