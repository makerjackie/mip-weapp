'use strict'

const { randomUUID, createHash } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const { cursorPredicateFor, pageRows } = require('../pagination')
const { appendLevelTransition } = require('../level-transitions')

const PLATFORM = { scopeType: 'PLATFORM', scopeId: null }
const BEHAVIORS = Object.freeze({
  INVITE_GUEST: '邀请嘉宾参加活动', EVENT_CHECKIN: '参加活动及签到', TASK_COMPLETED: '完成 NPC 任务',
  TEAM_INVITE: '为团队邀请嘉宾', OPPORTUNITY_REFERRAL: '引荐项目机会', OPPORTUNITY_COOPERATION: '完成机会合作',
})
const EVENT_BEHAVIORS = Object.freeze({
  'event.guest_invited': 'INVITE_GUEST', 'event.checked_in': 'EVENT_CHECKIN', 'task.completed': 'TASK_COMPLETED',
  'game.guest_invited': 'TEAM_INVITE', 'referral.confirmed': 'OPPORTUNITY_REFERRAL',
  'opportunity.cooperation.completed': 'OPPORTUNITY_COOPERATION',
})
const json = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback } catch { return fallback } }
const iso = value => value ? new Date(value).toISOString() : ''
const fail = code => { const error = new Error(code); error.code = code; throw error }

function createGrowthOperationsRepository(database, options = {}) {
  const id = options.id || randomUUID
  const { lockMutation, assertScope, writeAudit, writeOutbox } = options
  async function mutation(input, operation, request, work) {
    return database.transaction(async tx => {
      assertScope(await lockMutation(tx, input), PLATFORM)
      const claim = await claimOptional(tx, input, operation, request, id)
      if (claim.replay) return claim.replay
      const result = await work(tx)
      await complete(tx, input, operation, claim.requestHash, result)
      return result
    })
  }

  async function listContributionRules(input) {
    const clauses = ['app_id = ?', 'rule_uid IS NOT NULL']
    const params = [input.appId]
    if (input.filters.behavior) { clauses.push('behavior = ?'); params.push(input.filters.behavior) }
    if (input.filters.status) { clauses.push('status = ?'); params.push(input.filters.status) }
    if (input.filters.query) { clauses.push('behavior LIKE ?'); params.push(`%${input.filters.query}%`) }
    const cursor = cursorPredicateFor('created_at', input.cursor, 'createdAt', 'rule_uid')
    const rows = await database.query(`SELECT * FROM mip_contribution_rules WHERE ${clauses.join(' AND ')}${cursor.sql}
      ORDER BY created_at DESC, rule_uid DESC LIMIT ?`, [...params, ...cursor.params, input.limit + 1])
    return pageRows(rows.map(row => ({ id: row.rule_uid, ruleId: row.rule_uid, behavior: row.behavior,
      behaviorLabel: BEHAVIORS[row.behavior] || row.behavior, rewardExp: Number(row.reward_exp),
      rewardLimit: { kind: row.reward_limit_kind, value: Number(row.reward_limit) },
      scopeServers: json(row.scope_servers, []), effectiveFrom: iso(row.effective_from), effectiveTo: iso(row.effective_to),
      status: row.status, version: Number(row.version), createdAt: iso(row.created_at),
    })), input.limit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  async function saveContributionRule(input) {
    return mutation(input, 'contribution.rules.save', { ruleId: input.ruleId, version: input.expectedVersion, draft: input.draft }, async tx => {
      // The actor row acquired by lockMutation serializes writers with the same account;
      // the tenant app row also prevents races between different administrators.
      await tx.query(`INSERT INTO mip_app_settings (app_id, setting_key, value_json)
        VALUES (?, 'contribution.rules.lock', JSON_OBJECT()) ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)`, [input.appId])
      const rows = await tx.query('SELECT * FROM mip_contribution_rules WHERE app_id = ? ORDER BY rule_id FOR UPDATE', [input.appId])
      const current = rows.find(row => row.rule_uid === input.ruleId)
      if (input.ruleId && !current) fail('NOT_FOUND')
      if (current && Number(current.version) !== input.expectedVersion) fail('CONFLICT')
      const draft = input.draft
      if (draft.scopeServers.length) {
        const servers = await tx.query(`SELECT id FROM mip_city_branches WHERE app_id = ? AND status = 'ACTIVE'
          AND id IN (${draft.scopeServers.map(() => '?').join(',')}) FOR UPDATE`, [input.appId, ...draft.scopeServers])
        if (servers.length !== draft.scopeServers.length) fail('VALIDATION_FAILED')
      }
      for (const row of rows) {
        if (row.rule_uid === input.ruleId || row.status !== 'ACTIVE' || draft.status !== 'ACTIVE' || row.behavior !== draft.behavior) continue
        const servers = json(row.scope_servers, [])
        const scopeOverlaps = !servers.length || !draft.scopeServers.length || servers.some(server => draft.scopeServers.includes(server))
        const overlaps = (!row.effective_to || new Date(row.effective_to) > new Date(draft.effectiveFrom))
          && (!draft.effectiveTo || new Date(draft.effectiveTo) > new Date(row.effective_from))
        if (scopeOverlaps && overlaps) fail('CONTRIBUTION_RULE_CONFLICT')
      }
      const ruleId = input.ruleId || id()
      const values = [draft.behavior, draft.rewardExp, draft.rewardLimit.value, draft.rewardLimit.kind,
        JSON.stringify(draft.scopeServers), draft.effectiveFrom, draft.effectiveTo, draft.status]
      if (current) {
        const update = await tx.query(`UPDATE mip_contribution_rules SET behavior = ?, reward_exp = ?, reward_limit = ?, reward_limit_kind = ?,
          scope_servers = ?, effective_from = ?, effective_to = ?, status = ?, version = version + 1
          WHERE app_id = ? AND rule_uid = ? AND version = ?`, [...values, input.appId, ruleId, input.expectedVersion])
        if (Number(update.affectedRows) !== 1) fail('CONFLICT')
      }
      else await tx.query(`INSERT INTO mip_contribution_rules
        (behavior, reward_exp, reward_limit, reward_limit_kind, scope_servers, effective_from, effective_to, status, app_id, rule_uid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...values, input.appId, ruleId])
      await writeAudit(tx, input.audit(ruleId))
      return { id: ruleId, ruleId, version: current ? input.expectedVersion + 1 : 1 }
    })
  }

  async function listContributionTransactions(input) {
    const clauses = ["entry.app_id = ?", "entry.metric = 'CONTRIBUTION'"]
    const params = [input.appId]
    if (input.filters.userId) { clauses.push('entry.user_id = ?'); params.push(input.filters.userId) }
    if (input.filters.serverId) { clauses.push('member.primary_branch_id = ?'); params.push(input.filters.serverId) }
    if (input.filters.sinceTime) { clauses.push('entry.created_at >= ?'); params.push(input.filters.sinceTime) }
    if (input.filters.behavior) { clauses.push('entry.source_event_type = ?'); params.push(Object.keys(EVENT_BEHAVIORS).find(key => EVENT_BEHAVIORS[key] === input.filters.behavior) || input.filters.behavior) }
    if (input.filters.query) { clauses.push('(profile.nickname LIKE ? OR entry.user_id = ? OR entry.id = ?)'); params.push(`%${input.filters.query}%`, input.filters.query, input.filters.query) }
    const cursor = cursorPredicateFor('entry.created_at', input.cursor, 'createdAt', 'entry.id')
    const rows = await database.query(`SELECT entry.*, profile.nickname, member.primary_branch_id,
      (SELECT COALESCE(SUM(reversal.reversal_value), 0) FROM mip_contribution_reversals reversal
       WHERE reversal.app_id = entry.app_id AND reversal.original_txn_no = entry.id) AS reversed_value
      FROM mip_growth_entries entry JOIN mip_users member ON member.app_id = entry.app_id AND member.id = entry.user_id
      LEFT JOIN mip_profiles profile ON profile.app_id = entry.app_id AND profile.user_id = entry.user_id
      WHERE ${clauses.join(' AND ')}${cursor.sql} ORDER BY entry.created_at DESC, entry.id DESC LIMIT ?`, [...params, ...cursor.params, input.limit + 1])
    return pageRows(rows.map(row => ({ id: row.id, txnNo: row.id, transactionNo: row.id, userId: row.user_id,
      nickname: row.nickname || '未填写昵称', behavior: EVENT_BEHAVIORS[row.source_event_type] || row.source_event_type,
      behaviorLabel: BEHAVIORS[EVENT_BEHAVIORS[row.source_event_type]] || row.source_event_type,
      deltaValue: Number(row.delta_value), contributionValue: Number(row.delta_value), balanceAfter: Number(row.balance_after),
      relatedBusiness: row.source_event_id, createdAt: iso(row.created_at), occurredAt: iso(row.created_at),
      serverId: row.primary_branch_id, reversedValue: Number(row.reversed_value || 0),
      result: Number(row.reversed_value) > 0 ? 'REVERSED' : 'SUCCESS',
    })), input.limit, row => ({ createdAt: row.createdAt, id: row.id }))
  }

  async function reverseContribution(input) {
    return mutation(input, 'contribution.transactions.reverse', { original: input.originalTransactionNo, value: input.reversalValue, reason: input.reason }, async tx => {
      const original = await tx.one(`SELECT * FROM mip_growth_entries WHERE app_id = ? AND id = ? AND metric = 'CONTRIBUTION' FOR SHARE`, [input.appId, input.originalTransactionNo])
      if (!original) fail('NOT_FOUND')
      if (Number(original.delta_value) <= 0) fail('INVALID_STATE')
      const prior = await tx.one(`SELECT COALESCE(SUM(reversal_value), 0) AS total FROM mip_contribution_reversals
        WHERE app_id = ? AND original_txn_no = ?`, [input.appId, original.id])
      if (input.reversalValue > Number(original.delta_value) - Number(prior?.total || 0)) fail('REVERSAL_EXCEEDS_ORIGINAL')
      const account = await tx.one('SELECT contribution_balance, version FROM mip_growth_accounts WHERE app_id = ? AND user_id = ? FOR UPDATE', [input.appId, original.user_id])
      if (!account || Number(account.contribution_balance) < input.reversalValue) fail('INSUFFICIENT_BALANCE')
      const balanceAfter = Number(account.contribution_balance) - input.reversalValue
      const reversalId = id()
      const entryId = id()
      await tx.query(`UPDATE mip_growth_accounts SET contribution_balance = ?, version = version + 1 WHERE app_id = ? AND user_id = ?`, [balanceAfter, input.appId, original.user_id])
      await tx.query(`INSERT INTO mip_growth_entries (id, app_id, user_id, rule_id, source_event_id, source_event_type,
        metric, delta_value, balance_after, adjustment_reason, actor_user_id)
        VALUES (?, ?, ?, NULL, ?, 'CONTRIBUTION_REVERSAL', 'CONTRIBUTION', ?, ?, ?, ?)`,
      [entryId, input.appId, original.user_id, reversalId, -input.reversalValue, balanceAfter, input.reason, input.actorUserId])
      await tx.query(`INSERT INTO mip_contribution_reversals (reversal_no, app_id, original_txn_no, reversal_value, reason, reversed_by, growth_entry_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [reversalId, input.appId, original.id, input.reversalValue, input.reason, input.actorUserId, entryId])
      await writeAudit(tx, input.audit(reversalId))
      await writeOutbox(tx, { id: id(), appId: input.appId, aggregateType: 'GROWTH_ENTRY', aggregateId: entryId,
        eventType: 'growth.changed', sourceVersion: Number(account.version) + 1, payload: {} })
      return { reversalNo: reversalId, originalTransactionNo: original.id, reversalValue: input.reversalValue, balanceAfter }
    })
  }

  async function grantGrowthEntitlement(input) {
    return mutation(input, 'entitlements.grant', { userId: input.userId, metric: input.metric, amount: input.amount, reason: input.reason }, async tx => {
      const member = await tx.one('SELECT id, status FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE', [input.appId, input.userId])
      if (!member || member.status !== 'ACTIVE') fail('NOT_FOUND')
      await tx.query('INSERT INTO mip_growth_accounts (app_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)', [input.appId, input.userId])
      const account = await tx.one('SELECT experience_balance, contribution_balance, version FROM mip_growth_accounts WHERE app_id = ? AND user_id = ? FOR UPDATE', [input.appId, input.userId])
      const column = input.metric === 'EXPERIENCE' ? 'experience_balance' : input.metric === 'CONTRIBUTION' ? 'contribution_balance' : fail('VALIDATION_FAILED')
      const before = Number(account[column])
      const balanceAfter = before + input.amount
      if (!Number.isSafeInteger(balanceAfter)) fail('VALIDATION_FAILED')
      const entryId = id()
      const sourceEventId = createHash('sha256').update(`${input.actorUserId}\0entitlements\0${input.idempotencyKey}`).digest('hex').slice(0, 36)
      await tx.query(`UPDATE mip_growth_accounts SET ${column} = ?, version = version + 1 WHERE app_id = ? AND user_id = ?`, [balanceAfter, input.appId, input.userId])
      await tx.query(`INSERT INTO mip_growth_entries (id, app_id, user_id, rule_id, source_event_id, source_event_type, metric,
        delta_value, balance_after, adjustment_reason, actor_user_id) VALUES (?, ?, ?, NULL, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?, ?, ?)`,
      [entryId, input.appId, input.userId, sourceEventId, input.metric, input.amount, balanceAfter, input.reason, input.actorUserId])
      if (input.metric === 'EXPERIENCE') await appendLevelTransition(tx, { createId: id, appId: input.appId, userId: input.userId,
        sourceEventId, sourceEventType: 'ADMIN_ADJUSTMENT', experienceBefore: before, experienceAfter: balanceAfter })
      await writeAudit(tx, input.audit(entryId))
      await writeOutbox(tx, { id: id(), appId: input.appId, aggregateType: 'GROWTH_ENTRY', aggregateId: entryId,
        eventType: 'growth.changed', sourceVersion: Number(account.version) + 1, payload: {} })
      return { entitlementNo: entryId, userId: input.userId, amount: input.amount, balanceAfter }
    })
  }

  async function listEntitlementTransactions(input) {
    // A read projection over authoritative grants also includes historical automatic grants.
    const clauses = ['1 = 1']; const params = [input.appId, input.appId]
    if (input.filters.entitlementType) { clauses.push('ledger.entitlement_type = ?'); params.push(input.filters.entitlementType) }
    if (input.filters.sinceTime) { clauses.push('ledger.granted_at >= ?'); params.push(input.filters.sinceTime) }
    if (input.filters.query) { clauses.push('(ledger.nickname LIKE ? OR ledger.user_id = ? OR ledger.order_id = ? OR ledger.id = ?)'); params.push(`%${input.filters.query}%`, input.filters.query, input.filters.query, input.filters.query) }
    const cursor = cursorPredicateFor('ledger.granted_at', input.cursor, 'createdAt', 'ledger.id')
    const rows = await database.query(`SELECT ledger.* FROM (SELECT entry.id, entry.user_id, profile.nickname, IF(entry.metric = 'EXPERIENCE', 'EXP', 'CONTRIBUTION') AS entitlement_type,
      entry.delta_value AS amount, NULL AS months, NULL AS order_id, actor.nickname AS grantor,
      entry.created_at AS granted_at, IF(entry.actor_user_id IS NULL, 'SYSTEM', 'MANUAL') AS source
      FROM mip_growth_entries entry LEFT JOIN mip_profiles profile ON profile.app_id = entry.app_id AND profile.user_id = entry.user_id
      LEFT JOIN mip_profiles actor ON actor.app_id = entry.app_id AND actor.user_id = entry.actor_user_id
      WHERE entry.app_id = ? AND entry.metric IN ('EXPERIENCE', 'CONTRIBUTION') AND entry.delta_value > 0
      UNION ALL SELECT entitlement.id, entitlement.user_id, profile.nickname, 'MEMBERSHIP', plan.duration_days,
      COALESCE(adjustment.duration_months, CASE WHEN plan.duration_days IN (365, 366) THEN 12
        WHEN plan.duration_days IN (180, 182, 183) THEN 6 WHEN plan.duration_days IN (90, 91, 92) THEN 3
        WHEN plan.duration_days IN (30, 31) THEN 1 END), entitlement.order_id, actor.nickname, entitlement.created_at,
      IF(entitlement.source_type = 'ADMIN_ADJUSTMENT', 'MANUAL', 'SYSTEM')
      FROM mip_membership_entitlements entitlement
      LEFT JOIN mip_profiles profile ON profile.app_id = entitlement.app_id AND profile.user_id = entitlement.user_id
      LEFT JOIN mip_membership_adjustments adjustment ON adjustment.app_id = entitlement.app_id AND adjustment.id = entitlement.source_adjustment_id
      LEFT JOIN mip_membership_plans plan ON plan.app_id = entitlement.app_id AND plan.id = entitlement.plan_id
      LEFT JOIN mip_profiles actor ON actor.app_id = adjustment.app_id AND actor.user_id = adjustment.actor_user_id
      WHERE entitlement.app_id = ?) ledger WHERE ${clauses.join(' AND ')}${cursor.sql}
      ORDER BY ledger.granted_at DESC, ledger.id DESC LIMIT ?`, [...params, ...cursor.params, input.limit + 1])
    return pageRows(rows.map(row => ({ id: row.id, entitlementNo: row.id, userId: row.user_id, nickname: row.nickname || '未填写昵称',
      entitlementType: row.entitlement_type, entitlementContent: row.entitlement_type === 'MEMBERSHIP' ? (row.months ? `${row.months} 个月` : `${row.amount} 天`) : `${row.amount} ${row.entitlement_type === 'EXP' ? '经验值' : '贡献值'}`,
      amount: row.amount === null ? null : Number(row.amount), months: row.months === null ? null : Number(row.months),
      relatedOrderNo: row.order_id || null, grantor: row.grantor || (row.source === 'SYSTEM' ? '系统' : '管理员'),
      grantedAt: iso(row.granted_at), source: row.source,
    })), input.limit, row => ({ createdAt: row.grantedAt, id: row.id }))
  }

  return { listContributionRules, saveContributionRule, listContributionTransactions, reverseContribution,
    listEntitlementTransactions, grantGrowthEntitlement }
}

module.exports = { createGrowthOperationsRepository, BEHAVIORS }
