'use strict'

// MIW-55：机会列表状态可见性规则——
// 1. 公开流（机会模块招募中/已结束）永远不可能出下架卡：normalizeFilter 只收敛出
//    PUBLISHED / ENDED 两种状态，UNPUBLISHED 请求被折叠为 PUBLISHED；
// 2. 下架卡仅归属用户本人可见：listMine 不过滤 UNPUBLISHED（只排除 ARCHIVED）；
// 3. 他人视角（我想合作流）只看 PUBLISHED/ENDED。
// 发现 SQL 以源码契约断言钉住（本套件不做真实数据库连接）。

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')
const { normalizeFilter } = require('../domain/opportunities')

test('public stream filter collapses every request status to PUBLISHED or ENDED only', () => {
  assert.equal(normalizeFilter({}).status, 'PUBLISHED', '招募中默认 PUBLISHED')
  assert.equal(normalizeFilter({ status: 'COMPLETED' }).status, 'ENDED', '已结束 tab 请求 ENDED')
  for (const requested of ['UNPUBLISHED', 'ENDED', 'DRAFT', 'ARCHIVED', '任意值']) {
    const status = normalizeFilter({ status: requested }).status
    assert.ok(
      status === 'PUBLISHED' || status === 'ENDED',
      `请求 status=${requested} 必须收敛为 PUBLISHED/ENDED，实际 ${status}`,
    )
  }
  assert.equal(normalizeFilter({ status: 'UNPUBLISHED' }).status, 'PUBLISHED', '下架卡不可经公开流曝光')
})

test('owner stream keeps unpublished cards visible; peer streams exclude them', () => {
  const source = readFileSync(`${__dirname}/../domain/opportunities.js`, 'utf8')
  const listMineSql = source.slice(source.indexOf('async function listMine'), source.indexOf('async function listMyCooperations'))
  assert.match(listMineSql, /o\.status <> 'ARCHIVED'/, '本人列表保留 UNPUBLISHED（只排除 ARCHIVED）')
  assert.doesNotMatch(listMineSql, /status = \?/, '本人列表不得按单一状态过滤掉下架卡')

  const cooperationSql = source.slice(source.indexOf('async function listMyCooperations'), source.indexOf('async function getOpportunity'))
  assert.match(cooperationSql, /o\.status IN \('PUBLISHED', 'ENDED'\)/, '他人视角（我想合作流）只出 PUBLISHED/ENDED')
})
