import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

const eventsCopy = readFileSync(path.join(root, 'cloudfunctions/mip-events-api/domain/public-person-details.js'), 'utf8')
const opportunitiesCopy = readFileSync(path.join(root, 'cloudfunctions/mip-opportunities-api/domain/public-person-details.js'), 'utf8')

// loadHeartInviters 内的第一段模板字符串即共享 SQL（两副本逐字节一致是硬约束）。
function inviterSql(source: string) {
  const anchor = source.indexOf('async function loadHeartInviters')
  const start = source.indexOf('`', anchor)
  const end = source.indexOf('`', start + 1)
  return source.slice(start + 1, end)
}

// publicHeartInviter 函数体到下一个列 0 的 `}` 为止；注释与空白差异不视为口径漂移。
function inviterMapper(source: string) {
  const start = source.indexOf('function publicHeartInviter')
  const end = source.indexOf('\n}', start)
  return source.slice(start, end + 2).replace(/^\/\/.*$/gm, '').replace(/\s+/g, ' ').trim()
}

describe('MIW-85 heart inviter parity and SQL shape', () => {
  it('两处 loadHeartInviters 副本的共享 SQL 逐字节一致（勿单边改）', () => {
    expect(inviterSql(opportunitiesCopy)).toBe(inviterSql(eventsCopy))
  })

  it('两处 publicHeartInviter 映射口径一致（注释/空白不敏感）', () => {
    expect(inviterMapper(opportunitiesCopy)).toBe(inviterMapper(eventsCopy))
  })

  it('SQL 锁定玩家门控（INVITER-02）与最近一次确定性 tie-break（INVITER-01）', () => {
    const sql = inviterSql(eventsCopy)
    // 门控压在「每人最新一条」子查询上，与 activeMembershipSql 同表达式（读时判定）。
    expect(sql).toContain('MAX(recent.captured_at) AS captured_at')
    expect(sql).toContain('NOT EXISTS (')
    expect(sql).toContain('FROM mip_membership_entitlements membership')
    expect(sql).toContain('membership.status = \'ACTIVE\'')
    expect(sql).toContain('membership.starts_at <= UTC_TIMESTAMP(3)')
    expect(sql).toContain('membership.ends_at > UTC_TIMESTAMP(3)')
    // 同毫秒并列归档按 registration_id DESC 确定性取胜者。
    expect(sql).toContain('ORDER BY attribution.captured_at DESC, attribution.registration_id DESC')
  })
})
