'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { describe, it } = require('node:test')
const {
  applyLimits,
  createMatchingRequest,
  listMatchingResults,
  normalizePreferences,
  rankLocalCandidates,
  saveMatchingFeedback,
} = require('../domain/matching')
const { createMatchingProvider, normalizeRanking } = require('../domain/matching-provider')
const { createCandidateRef } = require('../lib/matching-candidate-ref')

const APP_ID = 'wx-matching-test'
const USER_ID = '10000000-0000-4000-8000-000000000001'
const OPPORTUNITY_ID = '20000000-0000-4000-8000-000000000001'
const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const CANDIDATE_ID = '40000000-0000-4000-8000-000000000001'
const PROFILE_SECRET = 'profile-reference-secret-with-32-characters'
const REFERENCE_SECRET = 'matching-reference-secret-with-32-characters'

const source = {
  roleKeys: ['PLANNER'],
  industryTagIds: ['industry-a'],
  abilityTagIds: ['ability-a'],
}

const candidates = [
  {
    id: CANDIDATE_ID,
    type: 'TALENT',
    roleKeys: ['PLANNER'],
    industryTagIds: ['industry-a'],
    abilityTagIds: ['ability-a'],
    branchMatched: true,
    cityMatched: false,
  },
  {
    id: '50000000-0000-4000-8000-000000000001',
    type: 'PROJECT',
    roleKeys: ['PLANNER'],
    industryTagIds: ['industry-b'],
    abilityTagIds: ['ability-a'],
    branchMatched: false,
    cityMatched: true,
  },
]

describe('opportunity matching', () => {
  it('ranks deterministically and keeps an explainable score breakdown', () => {
    const ranked = rankLocalCandidates(source, candidates)
    assert.deepEqual(ranked.map(item => [item.type, item.score]), [
      ['TALENT', 100],
      ['PROJECT', 75],
    ])
    assert.deepEqual(ranked[0].explanation.map(item => item.key), [
      'ROLE',
      'INDUSTRY',
      'ABILITY',
      'BRANCH',
    ])
    assert.equal(ranked[0].explanation.reduce((sum, item) => sum + item.weight, 0), ranked[0].score)
  })

  it('applies per-type preferences, score thresholds, and one bounded result limit', () => {
    const ranked = rankLocalCandidates(source, candidates)
    assert.deepEqual(applyLimits(ranked, {
      talentMinScore: 35,
      projectMinScore: 80,
      maximumCandidates: 1,
    }, {
      talentEnabled: true,
      projectEnabled: true,
    }).map(item => item.type), ['TALENT'])

    assert.deepEqual(applyLimits(ranked, {
      talentMinScore: 0,
      projectMinScore: 0,
      maximumCandidates: 100,
    }, {
      talentEnabled: false,
      projectEnabled: true,
    }).map(item => item.type), ['PROJECT'])
  })

  it('uses conservative defaults and requires explicit versions and scope', () => {
    assert.deepEqual(normalizePreferences({
      notificationVersion: 0,
      opportunityVersion: 0,
      matchingScope: 'PRIMARY_BRANCH',
    }), {
      notificationVersion: 0,
      opportunityVersion: 0,
      commentsEnabled: true,
      opportunityMatchingNotificationsEnabled: true,
      hotspotsEnabled: false,
      matchingEnabled: true,
      talentRecommendationsEnabled: true,
      projectRecommendationsEnabled: true,
      discoverableForMatching: true,
      matchingScope: 'PRIMARY_BRANCH',
    })
    assert.throws(() => normalizePreferences({
      notificationVersion: 0,
      opportunityVersion: 0,
      matchingScope: 'GLOBAL',
    }), /VALIDATION_FAILED/)
  })

  it('reauthorizes the source but returns an idempotent replay before candidate or provider work', async () => {
    const calls = []
    const database = {
      async one(sql, params) {
        calls.push({ sql, params })
        if (sql.includes('JSON_ARRAYAGG')) {
          return {
            id: OPPORTUNITY_ID,
            owner_user_id: USER_ID,
            branch_id: null,
            city_tag_id: null,
            title: '社区项目合作',
            version: 2,
            primary_branch_id: null,
            role_keys: '[]',
          }
        }
        if (sql.includes('requested_by_user_id')) {
          return {
            id: REQUEST_ID,
            request_hash: 'b513857d08cbd1069badfa9f0e55c9ba06530d6afcca5ad0b12d5f422d1d42dc',
          }
        }
        if (sql.includes('FROM mip_matching_requests request')) {
          return {
            id: REQUEST_ID,
            source_opportunity_id: OPPORTUNITY_ID,
            source_title: '社区项目合作',
            provider_key: 'LOCAL',
            source_version: 2,
            result_version: 1,
            result_count: 3,
            created_at: '2026-08-25T01:00:00.000Z',
          }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql) {
        calls.push({ sql, params: [] })
        if (sql.includes('mip_opportunity_tags')) { return [] }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    let providerCalled = false
    const result = await createMatchingRequest(database, {
      configured: true,
      async rank() {
        providerCalled = true
        throw new Error('must not run')
      },
    }, {
      appId: APP_ID,
      userId: USER_ID,
    }, {
      opportunityId: OPPORTUNITY_ID,
      idempotencyKey: 'matching-request-replay-001',
    })

    assert.equal(result.id, REQUEST_ID)
    assert.equal(result.resultCount, 3)
    assert.equal(providerCalled, false)
    assert.equal(calls.some(call => call.sql.includes('FROM mip_users candidate')), false)
  })

  it('sends anonymous public features only and blends a valid external ranking', async () => {
    let payload
    const provider = createMatchingProvider({
      async callFunction(request) {
        payload = request.data
        return {
          result: {
            candidates: payload.candidates.toReversed().map((candidate, index) => ({
              candidateRef: candidate.candidateRef,
              type: candidate.type,
              score: index === 0 ? 100 : 50,
            })),
          },
        }
      },
    }, {
      functionName: 'mip-ranking-provider',
      timeoutMs: 500,
    })
    const local = rankLocalCandidates(source, candidates).map((candidate, index) => ({
      ...candidate,
      candidateRef: createCandidateRef({
        appId: APP_ID,
        requestId: REQUEST_ID,
        resultVersion: 1,
        candidateType: candidate.type,
        candidateId: candidate.id,
      }, REFERENCE_SECRET),
      index,
    }))
    const result = await provider.rank({ candidates: local })

    assert.equal(result.providerKey, 'EXTERNAL')
    assert.deepEqual(result.candidates.map(item => [item.type, item.score]), [
      ['TALENT', 85],
      ['PROJECT', 83],
    ])
    assert.equal(JSON.stringify(payload).includes('nickname'), false)
    assert.equal(JSON.stringify(payload).includes('title'), false)
    assert.equal(JSON.stringify(payload).includes(candidates[0].id), false)
    assert.equal(JSON.stringify(payload).includes('industry-a'), false)
    assert.equal(Object.hasOwn(payload, 'source'), false)
    assert.equal(payload.contractVersion, 1)
  })

  it('fails safely to local ranking on timeout or invalid external output', async () => {
    const local = rankLocalCandidates(source, candidates).map((candidate, index) => ({
      ...candidate,
      candidateRef: `mc1.${String(index + 1).repeat(43)}`,
    }))
    assert.throws(() => normalizeRanking({ candidates: [] }, local), /MATCHING_PROVIDER_RESPONSE_INVALID/)
    const provider = createMatchingProvider({
      async callFunction() {
        return { result: { candidates: [] } }
      },
    }, {
      functionName: 'mip-ranking-provider',
      timeoutMs: 500,
    })
    const result = await provider.rank({ candidates: local })
    assert.equal(result.providerKey, 'LOCAL')
    assert.equal(result.fallbackReason, 'MATCHING_PROVIDER_RESPONSE_INVALID')
    assert.deepEqual(result.candidates, local)
  })

  it('re-filters historical talent results using current scope, blocks, and public visibility', async () => {
    let resultSql = ''
    const database = {
      async one() {
        return {
          id: REQUEST_ID,
          requester_user_id: USER_ID,
          source_opportunity_id: OPPORTUNITY_ID,
          result_version: 1,
          status: 'COMPLETED',
        }
      },
      async query(sql) {
        resultSql = sql
        return [{
          candidate_type: 'TALENT',
          candidate_id: CANDIDATE_ID,
          rank_no: 1,
          score: 100,
          explanation_json: JSON.stringify([
            { key: 'ROLE', label: '合作角色符合机会需求', weight: 45 },
            { key: 'INDUSTRY', label: '行业标签相符', weight: 20 },
            { key: 'ABILITY', label: '能力标签相符', weight: 20 },
            { key: 'BRANCH', label: '城市分会范围相符', weight: 15 },
          ]),
          nickname: '测试成员',
          headline: '测试简介',
          visibility_json: JSON.stringify({
            nickname: true,
            headline: true,
            industry: false,
            abilities: false,
            primaryBranch: false,
          }),
        }]
      },
    }

    const result = await listMatchingResults(database, {
      appId: APP_ID,
      userId: USER_ID,
      profileRefSecret: PROFILE_SECRET,
      matchingReferenceSecret: REFERENCE_SECRET,
    }, { requestId: REQUEST_ID, type: 'TALENT' })

    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].candidateRef.includes(CANDIDATE_ID), false)
    assert.equal(Object.hasOwn(result.items[0], 'id'), false)
    assert.equal(result.items[0].score, 45)
    assert.deepEqual(result.items[0].explanation.map(item => item.key), ['ROLE'])
    assert.match(resultSql, /discoverable_for_matching/)
    assert.match(resultSql, /candidate_preference\.matching_scope/)
    assert.match(resultSql, /NOT EXISTS[\s\S]+mip_user_blocks/)
    assert.match(resultSql, /ORDER BY latest\.created_at DESC, latest\.id DESC LIMIT 1/)
  })

  it('binds feedback replay to the resolved candidate, version, type, value, and reason', async () => {
    const candidateRef = createCandidateRef({
      appId: APP_ID,
      requestId: REQUEST_ID,
      resultVersion: 2,
      candidateType: 'TALENT',
      candidateId: CANDIDATE_ID,
    }, REFERENCE_SECRET)
    const requestHash = createHash('sha256').update(JSON.stringify({
      requestId: REQUEST_ID,
      resultVersion: 2,
      candidateType: 'TALENT',
      candidateId: CANDIDATE_ID,
      feedbackType: 'HELPFUL',
      reason: '推荐相关',
    })).digest('hex')
    const reads = []
    const tx = {
      async one(sql) {
        reads.push(sql)
        if (sql.includes('FROM mip_users')) { return { id: USER_ID, status: 'ACTIVE' } }
        if (sql.includes('FROM mip_matching_requests')) {
          return { requester_user_id: USER_ID, result_version: 2 }
        }
        if (sql.includes('FROM mip_matching_feedback')) {
          return {
            id: '50000000-0000-4000-8000-000000000001',
            request_hash: requestHash,
            feedback_type: 'HELPFUL',
            reason: '推荐相关',
          }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('FROM mip_matching_results')) { return [{ candidate_id: CANDIDATE_ID }] }
        throw new Error(`unexpected write: ${sql}`)
      },
    }
    const database = { transaction: work => work(tx) }
    const caller = {
      appId: APP_ID,
      userId: USER_ID,
      matchingReferenceSecret: REFERENCE_SECRET,
    }
    const replay = await saveMatchingFeedback(database, caller, {
      requestId: REQUEST_ID,
      candidateType: 'TALENT',
      candidateRef,
      feedbackType: 'HELPFUL',
      reason: '推荐相关',
      idempotencyKey: 'matching-feedback-replay-001',
    })
    assert.equal(replay.feedbackType, 'HELPFUL')
    const userRead = reads.findIndex(sql => sql.includes('FROM mip_users'))
    const requestRead = reads.findIndex(sql => sql.includes('FROM mip_matching_requests'))
    const feedbackRead = reads.findIndex(sql => sql.includes('FROM mip_matching_feedback'))
    assert.ok(userRead >= 0 && userRead < requestRead && requestRead < feedbackRead)
    assert.match(reads[userRead], /FOR UPDATE/)
    assert.doesNotMatch(reads[requestRead], /FOR UPDATE/)
    assert.doesNotMatch(reads[feedbackRead], /FOR UPDATE/)

    await assert.rejects(() => saveMatchingFeedback(database, caller, {
      requestId: REQUEST_ID,
      candidateType: 'TALENT',
      candidateRef,
      feedbackType: 'NOT_RELEVANT',
      reason: '推荐相关',
      idempotencyKey: 'matching-feedback-replay-001',
    }), /CONFLICT/)
  })

  it('replays a matching request found after locking the requester without appending facts', async () => {
    const requestHash = createHash('sha256').update(JSON.stringify({
      sourceId: OPPORTUNITY_ID,
      requestedByType: 'USER',
      requesterUserId: USER_ID,
    })).digest('hex')
    const transactionReads = []
    let transactionWrites = 0
    const tx = {
      async one(sql) {
        transactionReads.push(sql)
        if (sql.includes('FROM mip_users')) return { id: USER_ID, status: 'ACTIVE' }
        if (sql.includes('SELECT id, request_hash FROM mip_matching_requests')) {
          return { id: REQUEST_ID, request_hash: requestHash }
        }
        if (sql.includes('FROM mip_matching_requests request')) {
          return {
            id: REQUEST_ID,
            source_opportunity_id: OPPORTUNITY_ID,
            source_title: '社区项目合作',
            provider_key: 'LOCAL',
            source_version: 2,
            result_version: 1,
            result_count: 0,
            created_at: '2026-08-25T01:00:00.000Z',
          }
        }
        throw new Error(`unexpected transaction query: ${sql}`)
      },
      async query(sql) {
        transactionWrites += 1
        throw new Error(`unexpected transaction write: ${sql}`)
      },
    }
    const database = {
      async one(sql) {
        if (sql.includes('JSON_ARRAYAGG')) {
          return {
            id: OPPORTUNITY_ID,
            owner_user_id: USER_ID,
            branch_id: null,
            city_tag_id: null,
            title: '社区项目合作',
            version: 2,
            primary_branch_id: null,
            role_keys: '[]',
          }
        }
        if (sql.includes('SELECT id, request_hash FROM mip_matching_requests')) return null
        if (sql.includes('mip_user_opportunity_preferences')) return null
        if (sql.includes('mip_user_notification_preferences')) return null
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('mip_opportunity_tags')) return []
        if (sql.includes('FROM mip_matching_settings')) return []
        if (sql.includes('FROM mip_users candidate')) return []
        if (sql.includes('FROM mip_opportunities project')) return []
        throw new Error(`unexpected query: ${sql}`)
      },
      transaction: work => work(tx),
    }

    const result = await createMatchingRequest(database, { configured: false }, {
      appId: APP_ID,
      userId: USER_ID,
      matchingReferenceSecret: REFERENCE_SECRET,
    }, {
      opportunityId: OPPORTUNITY_ID,
      idempotencyKey: 'matching-transaction-replay-001',
    })

    assert.equal(result.id, REQUEST_ID)
    assert.equal(result.resultCount, 0)
    assert.equal(transactionWrites, 0)
    assert.match(transactionReads[0], /FROM mip_users[\s\S]+FOR UPDATE/)
    assert.match(transactionReads[1], /SELECT id, request_hash FROM mip_matching_requests/)
    assert.doesNotMatch(transactionReads[1], /FOR UPDATE/)
  })

  it('locks and rechecks matching preference and setting versions before result writes', async () => {
    const transactionQueries = []
    const candidateQueries = []
    const preference = {
      matching_enabled: 1,
      talent_recommendations_enabled: 1,
      project_recommendations_enabled: 1,
      matching_scope: 'PRIMARY_BRANCH',
      version: 1,
    }
    const notification = { opportunity_matching_notifications_enabled: 1, version: 1 }
    const setting = {
      scope_key: 'PLATFORM',
      scope_type: 'PLATFORM',
      scope_id: null,
      talent_min_score: 35,
      project_min_score: 30,
      maximum_candidates: 100,
      external_provider_enabled: 0,
      version: 1,
    }
    const currentSource = {
      id: OPPORTUNITY_ID,
      owner_user_id: USER_ID,
      branch_id: null,
      version: 2,
      status: 'PUBLISHED',
    }
    const tx = {
      async one(sql) {
        transactionQueries.push(sql)
        if (sql.includes('FROM mip_users')) { return { id: USER_ID, status: 'ACTIVE' } }
        if (sql.includes('FROM mip_matching_requests')) { return null }
        if (sql.includes('SELECT opportunity.id')) { return currentSource }
        if (sql.includes('mip_user_opportunity_preferences')) { return preference }
        if (sql.includes('mip_user_notification_preferences')) { return notification }
        throw new Error(`unexpected transaction query: ${sql}`)
      },
      async query(sql) {
        transactionQueries.push(sql)
        if (sql.includes('FROM mip_matching_settings')) { return [{ ...setting, version: 2 }] }
        throw new Error(`unexpected transaction write: ${sql}`)
      },
    }
    const database = {
      async one(sql) {
        if (sql.includes('JSON_ARRAYAGG')) {
          return {
            ...currentSource,
            city_tag_id: null,
            title: '社区项目合作',
            primary_branch_id: null,
            role_keys: '[]',
          }
        }
        if (sql.includes('FROM mip_matching_requests')) { return null }
        if (sql.includes('mip_user_opportunity_preferences')) { return preference }
        if (sql.includes('mip_user_notification_preferences')) { return notification }
        throw new Error(`unexpected query: ${sql}`)
      },
      async query(sql) {
        if (sql.includes('mip_opportunity_tags')) { return [] }
        if (sql.includes('FROM mip_matching_settings')) { return [setting] }
        if (sql.includes('FROM mip_users candidate') || sql.includes('FROM mip_opportunities project')) {
          candidateQueries.push(sql)
          return []
        }
        throw new Error(`unexpected query: ${sql}`)
      },
      transaction: work => work(tx),
    }

    await assert.rejects(() => createMatchingRequest(database, { configured: false }, {
      appId: APP_ID,
      userId: USER_ID,
      matchingReferenceSecret: REFERENCE_SECRET,
    }, {
      opportunityId: OPPORTUNITY_ID,
      idempotencyKey: 'matching-final-lock-001',
    }), /CONFLICT/)

    assert.equal(transactionQueries.some(sql => sql.includes('mip_user_opportunity_preferences')
      && sql.includes('FOR UPDATE')), true)
    assert.equal(transactionQueries.some(sql => sql.includes('mip_user_notification_preferences')
      && sql.includes('FOR UPDATE')), true)
    assert.equal(transactionQueries.some(sql => sql.includes('mip_matching_settings')
      && sql.includes('FOR UPDATE')), true)
    assert.equal(transactionQueries.some(sql => sql.includes('INSERT INTO mip_matching_requests')), false)
    assert.equal(candidateQueries.some(sql => /FROM mip_users candidate[\s\S]+ORDER BY candidate\.id[\s\S]+LIMIT/.test(sql)), true)
    assert.equal(candidateQueries.some(sql => /FROM mip_opportunities project[\s\S]+ORDER BY project\.id[\s\S]+LIMIT/.test(sql)), true)
    assert.equal(candidateQueries.some(sql => sql.includes("JSON_EXTRACT(profile.visibility_json, '$.primaryBranch')")), true)
  })
})
