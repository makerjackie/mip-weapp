import type { BranchId, CooperationRoleKey } from '../src/modules/mip'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeOpportunityDraft, normalizeOpportunityFilter } from '../src/modules/mip-opportunities/validation'

describe('MIP opportunity contracts', () => {
  it('enforces the identity full-access contract on protected server writes', () => {
    const auth = readFileSync(new URL('../cloudfunctions/mip-opportunities-api/lib/auth.js', import.meta.url), 'utf8')
    const entry = readFileSync(new URL('../cloudfunctions/mip-opportunities-api/index.js', import.meta.url), 'utf8')
    for (const action of [
      'saveOpportunity',
      'endOpportunity',
      'setReferral',
      'setProfileInterest',
      'saveCooperationCard',
      'unpublishCooperationCard',
      'archiveCooperationCard',
      'saveSuperCase',
      'unpublishSuperCase',
      'archiveSuperCase',
    ]) {
      expect(auth).toContain(`'${action}'`)
    }
    expect(entry).toContain('requiresFullAccessAction(action)')
    expect(entry).toContain('assertFullAccessReady(database, caller, configuredAgreementRequirements())')
    expect(auth).toContain('private_profile.phone_verified_at')
    expect(auth).toContain('facts.primary_branch_id')
    expect(auth).toMatch(/accepted\.has\(`\$\{requirement\.key\}:\$\{requirement\.version\}`\)/)
    expect(auth).not.toMatch(/fullAccessActions[\s\S]*markReceivedInteractionRead/)
    expect(auth).toContain('async function lockActiveContributor')
    expect(entry).not.toContain('case \'moderateOpportunity\':')
  })

  it('normalizes all supported filters without accepting unknown roles', () => {
    expect(normalizeOpportunityFilter({
      status: 'COMPLETED',
      keyword: '  品牌升级  ',
      minAmountCents: 100_000,
      maxAmountCents: 500_000,
      locationTypes: ['CITY', 'REMOTE'],
      roleKey: 'strategist',
      industryTagIds: ['industry-1', 'industry-1'],
      abilityTagIds: ['ability-1'],
      limit: 100,
    })).toEqual({
      status: 'COMPLETED',
      keyword: '品牌升级',
      cityTagId: undefined,
      minAmountCents: 100_000,
      maxAmountCents: 500_000,
      locationTypes: ['CITY', 'REMOTE'],
      locationCityTagIds: [],
      branchId: undefined,
      roleKey: 'strategist',
      industryTagIds: ['industry-1'],
      abilityTagIds: ['ability-1'],
      cursor: undefined,
      limit: 30,
    })

    expect(normalizeOpportunityFilter({
      status: 'RECRUITING',
      roleKey: 'unknown' as CooperationRoleKey,
    }).roleKey).toBeUndefined()
    expect(() => normalizeOpportunityFilter({
      status: 'RECRUITING',
      minAmountCents: 500,
      maxAmountCents: 100,
    })).toThrow('金额区间格式不正确')
  })

  it('requires a branch only for branch-scoped opportunities', () => {
    const base = {
      title: '城市品牌合作',
      valueSummary: '提供品牌和渠道资源',
      targetSummary: '寻找策划与视觉设计伙伴',
      description: '合作目标、范围和工作方式。',
      cityTagId: undefined,
      coverAssetId: undefined,
      roleKeys: ['strategist'] as CooperationRoleKey[],
      industryTagIds: [],
      abilityTagIds: [],
      publish: true,
    }
    expect(() => normalizeOpportunityDraft({ ...base, scopeType: 'BRANCH' })).toThrow('请选择城市分会')
    expect(normalizeOpportunityDraft({
      ...base,
      scopeType: 'BRANCH',
      branchId: '00000000-0000-4000-8000-000000000001' as BranchId,
    }).scopeType).toBe('BRANCH')
  })

  it('keeps the migration isolated and reversible', () => {
    const sql = readFileSync(new URL('../database/mysql/mip/003_opportunities.sql', import.meta.url), 'utf8')
    const rollback = readFileSync(new URL('../database/mysql/mip/rollback/003_opportunities.sql', import.meta.url), 'utf8')
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(match => match[1])
    expect(tables).toHaveLength(8)
    expect(tables.every(table => table.startsWith('mip_'))).toBe(true)
    expect(sql).toContain('UNIQUE KEY mip_referral_intents_actor_uk')
    expect(sql).toContain('UNIQUE KEY mip_profile_interests_pair_uk')
    expect(rollback).toContain('DROP TABLE IF EXISTS mip_opportunities')
    expect(sql).not.toMatch(/\b(member|dating|sewing)_/i)
  })

  it('shows the opportunity publication time in the detail view', () => {
    const page = readFileSync(new URL('../src/packages/member/mip-opportunities/detail/index.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('../src/packages/member/mip-opportunities/detail/index.wxml', import.meta.url), 'utf8')
    expect(page).toContain('formatLocalDateTime(item.publishedAt)')
    expect(view).toContain('发布于 {{publishedText}}')
  })
})
