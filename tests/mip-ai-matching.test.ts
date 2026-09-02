import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  retainMatchingFeedbackIntent,
  retainMatchingRequestIntent,
} from '../src/modules/mip-opportunities/matching-intent'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP AI opportunity matching contract', () => {
  it('adds app-scoped preferences, versioned results, feedback, and a replay-safe rollback', () => {
    const migration = read('database/mysql/mip/037_mip_ai_matching_preferences.sql')
    const rollback = read('database/mysql/mip/rollback/037_mip_ai_matching_preferences.sql')
    const tables = [
      'mip_user_notification_preferences',
      'mip_user_opportunity_preferences',
      'mip_matching_settings',
      'mip_matching_requests',
      'mip_matching_results',
      'mip_matching_feedback',
    ]
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
      expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`)
    }
    expect(migration).toContain('UNIQUE KEY mip_matching_requests_idempotency_uk')
    expect(migration).toContain('result_version BIGINT UNSIGNED NOT NULL')
    expect(migration).toContain('request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL')
    expect(migration).toMatch(/mip_matching_settings_branch_fk FOREIGN KEY \(app_id, scope_id\)[\s\S]+mip_city_branches \(app_id, id\)/)
    expect(migration).toMatch(/mip_matching_feedback_result_idx \([\s\S]+created_at DESC, id DESC[\s\S]+\)/)
    expect(migration).toMatch(/matching_scope IN \('PLATFORM', 'PRIMARY_BRANCH'\)/)
    expect(migration).not.toMatch(/\b(DROP TABLE|TRUNCATE TABLE|DELETE FROM)\b/i)
  })

  it('keeps matching behind the opportunity module and exposes user routes', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const member = app.subPackages.find(item => item.root === 'packages/member')
    expect(member?.pages).toContain('mip-opportunity-matching/index')
    expect(member?.pages).toContain('mip-opportunity-settings/index')

    const page = read('src/packages/member/mip-opportunity-matching/index.ts')
    expect(page).toContain('opportunityModule.createMatchingRequest')
    expect(page).toContain('retainMatchingRequestIntent')
    expect(page).toContain('retainMatchingFeedbackIntent')
    expect(page).toContain('candidateRef')
    expect(page).not.toContain('wx.cloud')
  })

  it('retains one idempotency key for the same user intent and rotates it after intent changes', () => {
    let sequence = 0
    const createKey = () => `stable-key-${++sequence}`
    const request = retainMatchingRequestIntent(null, 'opportunity-a', createKey)
    expect(retainMatchingRequestIntent(request, 'opportunity-a', createKey)).toBe(request)
    expect(retainMatchingRequestIntent(request, 'opportunity-b', createKey).idempotencyKey)
      .toBe('stable-key-2')

    const feedbackInput = {
      requestId: 'request-a',
      candidateType: 'TALENT' as const,
      candidateRef: 'mc1.reference-a',
      feedbackType: 'HELPFUL' as const,
      reason: '  推荐相关  ',
    }
    const feedback = retainMatchingFeedbackIntent(null, feedbackInput, createKey)
    expect(retainMatchingFeedbackIntent(feedback, {
      ...feedbackInput,
      reason: '推荐相关',
    }, createKey)).toBe(feedback)
    expect(retainMatchingFeedbackIntent(feedback, {
      ...feedbackInput,
      feedbackType: 'NOT_RELEVANT',
    }, createKey).idempotencyKey).toBe('stable-key-4')
  })

  it('keeps the optional provider and internal secret in deployment configuration only', () => {
    const env = read('.env.example')
    const deploy = read('scripts/deploy-functions.mjs')
    expect(env).toContain('MIP_MATCHING_PROVIDER_FUNCTION_NAME=')
    expect(env).toContain('MIP_MATCHING_INTERNAL_HMAC_SECRET=')
    expect(env).toContain('MIP_MATCHING_REFERENCE_SECRET=')
    expect(deploy).toContain('MIP_MATCHING_INTERNAL_HMAC_SECRET: options.secrets.matchingInternalHmac')
    expect(deploy).toContain('MIP_MATCHING_REFERENCE_SECRET: options.secrets.matchingReference')
    expect(deploy).toContain('MIP_MATCHING_PROVIDER_TIMEOUT_MS: String(options.matchingProviderTimeoutMs)')
    const migration = read('database/mysql/mip/037_mip_ai_matching_preferences.sql')
    expect(migration).not.toContain('MIP_MATCHING_INTERNAL_HMAC_SECRET')
    expect(migration).not.toContain('MIP_MATCHING_REFERENCE_SECRET')
  })
})
