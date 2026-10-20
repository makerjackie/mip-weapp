import assert from 'node:assert/strict'
import { it } from 'node:test'
import { userAccountStatus, userDashboardMetrics } from './user-profile-dashboard.ts'
it('renders exactly eight metrics and distinguishes real zeroes from missing aggregates', () => {
  const metrics = userDashboardMetrics({ influence: { guestCount: 0, outgoingHeartCount: 3, incomingHeartCount: 4, visitCount: 10, visitorCount: 2, referralCount: 1 }, counts: { registrations: 5, attended: 4, opportunities: 2 } })
  assert.equal(metrics.length, 8)
  assert.equal(metrics[0].value, '0 人')
  assert.equal(metrics[1].value, '—')
  assert.equal(metrics[4].value, '10 次 / 2 人')
  assert.equal(metrics[5].value, '报名 5 / 签到 4')
  assert.equal(metrics[6].value, '2 个')
})
it('does not convert failed reads into a success-looking zero', () => {
  assert.equal(userDashboardMetrics({ influence: { loadFailed: true, guestCount: 0 }, counts: { loadFailed: true, registrations: 0 } })[0].value, '—')
  assert.equal(userAccountStatus('BLOCKED'), '已冻结')
})
