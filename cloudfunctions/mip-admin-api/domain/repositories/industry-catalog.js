'use strict'

const { randomUUID } = require('node:crypto')
const { claimOptional, complete } = require('../idempotency')
const SCOPE = Object.freeze({ scopeType: 'PLATFORM', scopeId: null })

function createIndustryCatalogRepository(database, dependencies) {
  const { lockMutationAuthorization, assertMutationScope, writeAudit } = dependencies
  const createId = dependencies.createId || randomUUID
  const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }) }

  async function listIndustryCatalog(appId) {
    const rows = await database.query(`SELECT id, tag_key, label, parent_id, selectable, popular, enabled, sort_order, version
      FROM mip_tags WHERE app_id = ? AND kind = 'INDUSTRY' ORDER BY sort_order, id LIMIT 1001`, [appId])
    if (rows.length > 1000) fail('VALIDATION_FAILED', '行业目录超过1000项，请联系维护人员')
    return { items: rows.map(dto) }
  }

  async function mutate(input, operation, request, action) {
    return database.transaction(async tx => {
      const authorization = await lockMutationAuthorization(tx, input)
      assertMutationScope(authorization, SCOPE)
      if (authorization.effectiveGrant.roleKey !== 'PLATFORM_OWNER') fail('FORBIDDEN')
      const claimed = await claimOptional(tx, input, operation, request, createId)
      if (claimed.replay) return claimed.replay
      // Serialize all owners in this app: name checks, hierarchy and parent status share one lock order.
      await tx.query(`INSERT INTO mip_app_settings (app_id, setting_key, value_json)
        VALUES (?, 'industry_catalog_mutex', JSON_OBJECT()) ON DUPLICATE KEY UPDATE setting_key = setting_key`, [input.appId])
      await tx.one("SELECT setting_key FROM mip_app_settings WHERE app_id = ? AND setting_key = 'industry_catalog_mutex' FOR UPDATE", [input.appId])
      const { response, before, after } = await action(tx)
      const audit = input.audit(response.id)
      await writeAudit(tx, { ...audit, metadata: { ...audit.metadata, before, after } })
      await complete(tx, input, operation, claimed.requestHash, response)
      return response
    })
  }

  async function locked(tx, appId, tagId) {
    return tx.one(`SELECT id, tag_key, label, parent_id, selectable, popular, enabled, sort_order, version
      FROM mip_tags WHERE app_id = ? AND id = ? AND kind = 'INDUSTRY' FOR UPDATE`, [appId, tagId])
  }

  async function parent(tx, input) {
    if (!input.parentId) return null
    const row = await locked(tx, input.appId, input.parentId)
    if (!row || row.parent_id || Number(row.selectable) !== 0) fail('VALIDATION_FAILED', '请选择有效的一级分类')
    return row
  }

  function currentVersion(row, version) {
    if (!row) fail('NOT_FOUND')
    if (Number(row.version) !== version) fail('CONFLICT')
  }

  async function saveIndustryTag(input) {
    const request = { tagId: input.tagId, expectedVersion: input.expectedVersion, label: input.label, parentId: input.parentId, popular: input.popular, sortOrder: input.sortOrder }
    return mutate(input, 'admin.industries.save', request, async tx => {
      const id = input.tagId || createId()
      const current = input.tagId ? await locked(tx, input.appId, id) : null
      if (input.tagId) currentVersion(current, input.expectedVersion)
      if (current && Boolean(Number(current.selectable)) !== Boolean(input.parentId)) fail('VALIDATION_FAILED', '一级分类与二级行业不能相互转换')
      await parent(tx, input)
      const duplicate = await tx.one(`SELECT id FROM mip_tags WHERE app_id = ? AND kind = 'INDUSTRY'
        AND parent_id <=> ? AND label = ? AND id <> ? FOR UPDATE`, [input.appId, input.parentId, input.label, id])
      if (duplicate) fail('VALIDATION_FAILED', '同一分类下的名称已存在')
      if (current) {
        const result = await tx.query(`UPDATE mip_tags SET label = ?, parent_id = ?, popular = ?, sort_order = ?, version = version + 1
          WHERE app_id = ? AND id = ? AND kind = 'INDUSTRY' AND version = ?`, [input.label, input.parentId, Number(input.popular), input.sortOrder, input.appId, id, input.expectedVersion])
        if (Number(result.affectedRows) !== 1) fail('CONFLICT')
      } else {
        const count = await tx.one("SELECT COUNT(*) AS total FROM mip_tags WHERE app_id = ? AND kind = 'INDUSTRY'", [input.appId])
        if (Number(count?.total) >= 1000) fail('VALIDATION_FAILED', '行业目录最多支持1000项')
        await tx.query(`INSERT INTO mip_tags (id, app_id, kind, tag_key, label, parent_id, selectable, popular, enabled, sort_order)
          VALUES (?, ?, 'INDUSTRY', ?, ?, ?, ?, ?, 0, ?)`, [id, input.appId, `custom_${id}`, input.label, input.parentId, Number(Boolean(input.parentId)), Number(input.popular), input.sortOrder])
      }
      const version = current ? input.expectedVersion + 1 : 1
      return {
        response: { id, version },
        before: current ? dto(current) : null,
        after: { id, version, label: input.label, parentId: input.parentId, selectable: Boolean(input.parentId), popular: input.popular, sortOrder: input.sortOrder, enabled: current ? Boolean(Number(current.enabled)) : false },
      }
    })
  }

  async function changeIndustryTagStatus(input) {
    return mutate(input, 'admin.industries.status', { tagId: input.tagId, expectedVersion: input.expectedVersion, enabled: input.enabled }, async tx => {
      const current = await locked(tx, input.appId, input.tagId)
      currentVersion(current, input.expectedVersion)
      if (input.enabled && current.parent_id) {
        const group = await parent(tx, { ...input, parentId: current.parent_id })
        if (Number(group.enabled) !== 1) fail('VALIDATION_FAILED', '请先启用所属一级分类')
      }
      const result = await tx.query(`UPDATE mip_tags SET enabled = ?, version = version + 1
        WHERE app_id = ? AND id = ? AND kind = 'INDUSTRY' AND version = ?`, [Number(input.enabled), input.appId, input.tagId, input.expectedVersion])
      if (Number(result.affectedRows) !== 1) fail('CONFLICT')
      return { response: { id: input.tagId, version: input.expectedVersion + 1 }, before: dto(current), after: { ...dto(current), enabled: input.enabled, version: input.expectedVersion + 1 } }
    })
  }
  return { listIndustryCatalog, saveIndustryTag, changeIndustryTagStatus }
}

function dto(row) {
  return { id: row.id, label: row.label, parentId: row.parent_id || null, selectable: Boolean(Number(row.selectable)), popular: Boolean(Number(row.popular)), enabled: Boolean(Number(row.enabled)), sortOrder: Number(row.sort_order), version: Number(row.version) }
}

module.exports = { createIndustryCatalogRepository }
