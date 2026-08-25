'use strict'

const { createHash, randomUUID } = require('node:crypto')
const net = require('node:net')
const { capabilitiesForBinding } = require('./capabilities')
const { assertFullAccessUser, createFullAccessPolicy } = require('./full-access')

const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000'
const CONTENT_TYPES = new Set(['HOT_NEWS', 'ARTICLE', 'WEB', 'VIDEO', 'PRIVATE_CHANNEL', 'EXPERT_SHARE'])
const ACCESS_TYPES = new Set(['FREE', 'MEMBER', 'MEMBER_OR_PAID'])
const REPORT_CATEGORIES = new Set([
  'SPAM', 'HARASSMENT', 'FRAUD', 'INAPPROPRIATE_CONTENT', 'IMPERSONATION', 'OTHER',
])

function createKnowledgeAdminService(database, options = {}) {
  const createId = options.id || randomUUID
  const fullAccessPolicy = options.fullAccessPolicy || createFullAccessPolicy({
    agreements: options.agreements,
  })
  const catalogStage = options.catalogStage === 'LIVE' ? 'LIVE' : 'TEST'
  const defaultTestPriceCents = boundedInteger(options.defaultTestPriceCents, 990, 1, 10_000_000)
  const contentSafety = options.contentSafety || (async () => 'ERROR')
  const fetchSource = options.fetchSource
  const sourceAllowedHosts = configuredHosts(options.sourceAllowedHosts)
  const webviewAllowedHosts = configuredHosts(options.webviewAllowedHosts)

  async function admin(caller) {
    return authorizedAdmin(database, caller, false)
  }

  async function lockAdmin(tx, caller, expectedUserId) {
    const context = await authorizedAdmin(tx, caller, true)
    if (context.userId !== expectedUserId) throw codeError('FORBIDDEN')
    return context
  }

  async function authorizedAdmin(queryable, caller, lock) {
    const user = assertFullAccessUser(
      await fullAccessPolicy.loadByIdentity(queryable, caller, { lock }),
    )
    const rows = await queryable.query(
      `SELECT binding.role_key, binding.scope_type, binding.scope_id,
              policy.policy_mode, policy.capabilities_json
       FROM mip_admin_role_bindings binding
       LEFT JOIN mip_role_capability_policies policy
         ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
       WHERE binding.app_id = ? AND binding.user_id = ? AND binding.status = 'ACTIVE'
       ${lock ? 'FOR UPDATE' : ''}`,
      [caller.appId, user.id],
    )
    const bindings = rows.map(row => ({
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeId: row.scope_type === 'PLATFORM' && row.scope_id === PLATFORM_SCOPE_ID ? null : row.scope_id,
      policyCapabilities: row.policy_mode === 'CUSTOM' ? row.capabilities_json : undefined,
    }))
    const grant = bindings.find(binding => binding.scopeType === 'PLATFORM'
      && capabilitiesForBinding(binding).includes('knowledge.manage'))
    if (!grant) throw codeError('FORBIDDEN')
    return { appId: caller.appId, userId: user.id, roleKey: grant.roleKey, caller }
  }

  async function listKnowledgeAdmin(caller, input = {}) {
    const context = await admin(caller)
    const section = String(input.section || 'CONTENTS').toUpperCase()
    const limit = pageLimit(input.limit)
    if (section === 'SOURCES') {
      const rows = await database.query(
        `SELECT id, source_key, name, source_type, endpoint_url, status,
                fetch_config_json, last_fetched_at, version, created_at, updated_at
         FROM mip_knowledge_sources WHERE app_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
        [context.appId, limit],
      )
      return { section, items: rows.map(sourceDto), nextCursor: null }
    }
    if (section === 'CATEGORIES') {
      const rows = await database.query(
        `SELECT category.id, category.category_key, category.name, category.summary,
                category.sort_order, category.status, category.version,
                COUNT(content.id) AS content_count
         FROM mip_knowledge_categories category
         LEFT JOIN mip_knowledge_contents content
           ON content.app_id = category.app_id AND content.category_id = category.id
         WHERE category.app_id = ? GROUP BY category.id
         ORDER BY category.sort_order ASC, category.id ASC LIMIT ?`,
        [context.appId, limit],
      )
      return { section, items: rows.map(categoryAdminDto), nextCursor: null }
    }
    if (section === 'COMMENTS') {
      const status = optionalEnum(input.status, ['PENDING', 'PUBLISHED', 'HIDDEN', 'DELETED'])
      const rows = await database.query(
        `SELECT comment.id, comment.target_id AS content_id, content.title AS content_title,
                comment.body, comment.status, comment.version, comment.created_at,
                profile.nickname AS author_nickname,
                COUNT(report.id) AS report_count
         FROM mip_content_comments comment
         INNER JOIN mip_knowledge_contents content
           ON content.app_id = comment.app_id AND content.id = comment.target_id
            AND comment.target_type = 'KNOWLEDGE'
         LEFT JOIN mip_profiles profile
           ON profile.app_id = comment.app_id AND profile.user_id = comment.author_user_id
         LEFT JOIN mip_content_comment_reports report
           ON report.app_id = comment.app_id AND report.comment_id = comment.id
            AND report.status IN ('PENDING', 'REVIEWING')
         WHERE comment.app_id = ? AND (? IS NULL OR comment.status = ?)
         GROUP BY comment.id ORDER BY comment.created_at DESC, comment.id DESC LIMIT ?`,
        [context.appId, status, status, limit],
      )
      return { section, items: rows.map(commentAdminDto), nextCursor: null }
    }
    if (section === 'REPORTS') {
      const status = optionalEnum(input.status, ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
      const rows = await database.query(
        `SELECT report.id, report.comment_id, report.category, report.description,
                report.status, report.version, report.resolution_reason, report.created_at,
                comment.target_id AS content_id, content.title AS content_title,
                profile.nickname AS reporter_nickname
         FROM mip_content_comment_reports report
         INNER JOIN mip_content_comments comment
           ON comment.app_id = report.app_id AND comment.id = report.comment_id
            AND comment.target_type = 'KNOWLEDGE'
         INNER JOIN mip_knowledge_contents content
           ON content.app_id = comment.app_id AND content.id = comment.target_id
         LEFT JOIN mip_profiles profile
           ON profile.app_id = report.app_id AND profile.user_id = report.reporter_user_id
         WHERE report.app_id = ? AND (? IS NULL OR report.status = ?)
         ORDER BY report.created_at DESC, report.id DESC LIMIT ?`,
        [context.appId, status, status, limit],
      )
      return { section, items: rows.map(reportAdminDto), nextCursor: null }
    }
    if (section === 'RUNS') {
      const rows = await database.query(
        `SELECT run.id, run.source_id, source.name AS source_name, run.trigger_type,
                run.status, run.fetched_count, run.created_count, run.duplicate_count,
                run.rejected_count, run.last_error_code, run.started_at, run.completed_at
         FROM mip_knowledge_ingestion_runs run
         INNER JOIN mip_knowledge_sources source
           ON source.app_id = run.app_id AND source.id = run.source_id
         WHERE run.app_id = ? ORDER BY run.started_at DESC, run.id DESC LIMIT ?`,
        [context.appId, limit],
      )
      return { section, items: rows.map(runDto), nextCursor: null }
    }
    const status = optionalEnum(input.status, ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'WITHDRAWN'])
    const rows = await database.query(
      `SELECT content.id, content.title, content.summary, content.content_type,
              content.access_type, content.status, content.content_safety_status,
              content.author_name, content.version, content.reviewed_at,
              content.published_at, content.updated_at,
              category.id AS category_id, category.name AS category_name,
              source.id AS source_id, source.name AS source_name,
              product.id AS product_id, product.name AS product_name, product.catalog_stage,
              product.price_cents, product.currency, product.status AS product_status,
              product.unlock_days, product.refund_policy, product.refund_window_hours,
              product.version AS product_version
       FROM mip_knowledge_contents content
       INNER JOIN mip_knowledge_categories category
         ON category.app_id = content.app_id AND category.id = content.category_id
       LEFT JOIN mip_knowledge_sources source
         ON source.app_id = content.app_id AND source.id = content.source_id
       LEFT JOIN mip_knowledge_products product
         ON product.app_id = content.app_id AND product.content_id = content.id
        AND product.catalog_stage = ?
       WHERE content.app_id = ? AND (? IS NULL OR content.status = ?)
       ORDER BY content.updated_at DESC, content.id DESC LIMIT ?`,
      [catalogStage, context.appId, status, status, limit],
    )
    return { section: 'CONTENTS', items: rows.map(contentAdminDto), nextCursor: null }
  }

  async function getKnowledgeAdminContent(caller, input = {}) {
    const context = await admin(caller)
    const contentId = requiredUuid(input.contentId)
    const row = await database.one(
      `SELECT content.*, category.name AS category_name, source.name AS source_name,
              product.id AS product_id, product.name AS product_name, product.catalog_stage,
              product.price_cents, product.currency, product.status AS product_status,
              product.unlock_days, product.refund_policy, product.refund_window_hours,
              product.version AS product_version,
              COALESCE(settings.comments_enabled, 1) AS comments_enabled,
              COALESCE(settings.moderation_mode, 'AUTO') AS moderation_mode,
              COALESCE(settings.version, 0) AS settings_version
       FROM mip_knowledge_contents content
       INNER JOIN mip_knowledge_categories category
         ON category.app_id = content.app_id AND category.id = content.category_id
       LEFT JOIN mip_knowledge_sources source
         ON source.app_id = content.app_id AND source.id = content.source_id
       LEFT JOIN mip_knowledge_products product
         ON product.app_id = content.app_id AND product.content_id = content.id
        AND product.catalog_stage = ?
       LEFT JOIN mip_content_comment_settings settings
         ON settings.app_id = content.app_id AND settings.target_type = 'KNOWLEDGE'
        AND settings.target_id = content.id
       WHERE content.app_id = ? AND content.id = ?`,
      [catalogStage, context.appId, contentId],
    )
    if (!row) throw codeError('NOT_FOUND')
    return contentAdminDetailDto(row)
  }

  async function saveKnowledgeSource(caller, input = {}) {
    const authorization = await admin(caller)
    const draft = normalizeSource(input, sourceAllowedHosts)
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const sourceId = draft.id || createId()
      if (draft.id) {
        const current = await locked(tx, 'mip_knowledge_sources', context.appId, sourceId)
        versionMatch(current, draft.expectedVersion)
        await tx.query(
          `UPDATE mip_knowledge_sources SET name = ?, source_type = ?, endpoint_url = ?,
            status = ?, fetch_config_json = ?, updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.name, draft.sourceType, draft.endpointUrl, draft.status,
            JSON.stringify(draft.fetchConfig), context.userId, context.appId, sourceId, draft.expectedVersion],
        )
      }
      else {
        await tx.query(
          `INSERT INTO mip_knowledge_sources (
            id, app_id, source_key, name, source_type, endpoint_url, status,
            fetch_config_json, created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [sourceId, context.appId, draft.sourceKey, draft.name, draft.sourceType,
            draft.endpointUrl, draft.status, JSON.stringify(draft.fetchConfig), context.userId, context.userId],
        )
      }
      await audit(tx, context, 'admin.knowledge.source.save', 'KNOWLEDGE_SOURCE', sourceId, {
        sourceKey: draft.sourceKey,
      })
      return { id: sourceId, version: draft.id ? draft.expectedVersion + 1 : 1 }
    })
  }

  async function saveKnowledgeCategory(caller, input = {}) {
    const authorization = await admin(caller)
    const draft = normalizeCategory(input)
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const categoryId = draft.id || createId()
      if (draft.id) {
        const current = await locked(tx, 'mip_knowledge_categories', context.appId, categoryId)
        versionMatch(current, draft.expectedVersion)
        await tx.query(
          `UPDATE mip_knowledge_categories SET name = ?, summary = ?, sort_order = ?, status = ?,
            updated_by_user_id = ?, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.name, draft.summary || null, draft.sortOrder, draft.status, context.userId,
            context.appId, categoryId, draft.expectedVersion],
        )
      }
      else {
        await tx.query(
          `INSERT INTO mip_knowledge_categories (
            id, app_id, category_key, name, summary, sort_order, status,
            created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [categoryId, context.appId, draft.categoryKey, draft.name, draft.summary || null,
            draft.sortOrder, draft.status, context.userId, context.userId],
        )
      }
      await audit(tx, context, 'admin.knowledge.category.save', 'KNOWLEDGE_CATEGORY', categoryId, {
        categoryKey: draft.categoryKey,
      })
      return { id: categoryId, version: draft.id ? draft.expectedVersion + 1 : 1 }
    })
  }

  async function saveKnowledgeContent(caller, input = {}) {
    const authorization = await admin(caller)
    const draft = normalizeContent(input, webviewAllowedHosts)
    const safety = await contentSafety(draft, caller)
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      await assertCategoryAndSource(tx, context.appId, draft.categoryId, draft.sourceId)
      const contentId = draft.id || createId()
      if (draft.id) {
        const current = await locked(tx, 'mip_knowledge_contents', context.appId, contentId)
        versionMatch(current, draft.expectedVersion)
        if (current.status === 'PUBLISHED') throw codeError('INVALID_STATE')
        await tx.query(
          `UPDATE mip_knowledge_contents SET source_id = ?, category_id = ?, content_type = ?,
            title = ?, summary = ?, body_text = ?, external_url = ?,
            channel_finder_username = ?, channel_feed_id = ?, cover_asset_id = ?,
            author_name = ?, access_type = ?, status = 'DRAFT', content_safety_status = ?,
            updated_by_user_id = ?, reviewed_by_user_id = NULL, review_reason = NULL,
            reviewed_at = NULL, version = version + 1
           WHERE app_id = ? AND id = ? AND version = ?`,
          [draft.sourceId, draft.categoryId, draft.contentType, draft.title, draft.summary,
            draft.bodyText, draft.externalUrl, draft.channelFinderUserName, draft.channelFeedId,
            draft.coverAssetId, draft.authorName,
            draft.accessType, safety, context.userId, context.appId, contentId, draft.expectedVersion],
        )
      }
      else {
        await tx.query(
          `INSERT INTO mip_knowledge_contents (
            id, app_id, source_id, category_id, content_type, title, summary, body_text,
            external_url, channel_finder_username, channel_feed_id,
            cover_asset_id, author_name, access_type, status,
            content_safety_status, created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
          [contentId, context.appId, draft.sourceId, draft.categoryId, draft.contentType,
            draft.title, draft.summary, draft.bodyText, draft.externalUrl,
            draft.channelFinderUserName, draft.channelFeedId, draft.coverAssetId,
            draft.authorName, draft.accessType, safety, context.userId, context.userId],
        )
      }
      await ensureCommentSettings(tx, context, contentId, draft.commentsEnabled, draft.moderationMode)
      await audit(tx, context, 'admin.knowledge.content.save', 'KNOWLEDGE_CONTENT', contentId, {
        contentType: draft.contentType, accessType: draft.accessType, safety,
      })
      return { id: contentId, status: 'DRAFT', contentSafetyStatus: safety, version: draft.id ? draft.expectedVersion + 1 : 1 }
    })
  }

  async function reviewKnowledgeContent(caller, input = {}) {
    const authorization = await admin(caller)
    const contentId = requiredUuid(input.contentId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    const decision = optionalEnum(input.decision, ['SUBMIT', 'APPROVE', 'REJECT', 'PUBLISH', 'WITHDRAW'])
    if (!decision) throw codeError('VALIDATION_FAILED')
    const reason = optionalText(input.reason, 300)
    let safety
    if (decision === 'APPROVE') {
      const content = await database.one(
        `SELECT title, summary, body_text AS body, content_type, external_url FROM mip_knowledge_contents
         WHERE app_id = ? AND id = ?`,
        [authorization.appId, contentId],
      )
      if (!content) throw codeError('NOT_FOUND')
      assertKnowledgeDeliveryUrl(content, webviewAllowedHosts)
      safety = await contentSafety(content, caller)
      if (safety !== 'PASSED') throw codeError('CONTENT_SAFETY_REQUIRED')
    }
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const current = await locked(tx, 'mip_knowledge_contents', context.appId, contentId)
      versionMatch(current, expectedVersion)
      if (decision === 'PUBLISH') assertKnowledgeDeliveryUrl(current, webviewAllowedHosts)
      const transition = knowledgeTransition(current, decision, reason, safety, context.userId)
      await tx.query(
        `UPDATE mip_knowledge_contents SET status = ?, content_safety_status = ?,
          reviewed_by_user_id = ?, review_reason = ?, reviewed_at = ?,
          published_at = ?, withdrawn_at = ?, updated_by_user_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [transition.status, transition.safety, transition.reviewer, transition.reason,
          transition.reviewedAt, transition.publishedAt, transition.withdrawnAt,
          context.userId, context.appId, contentId, expectedVersion],
      )
      if (decision === 'PUBLISH') {
        await appendOutbox(tx, context.appId, contentId, 'KNOWLEDGE_CONTENT',
          'knowledge.content_published', expectedVersion + 1)
      }
      await audit(tx, context, `admin.knowledge.content.${decision.toLowerCase()}`,
        'KNOWLEDGE_CONTENT', contentId, { reason: reason || null })
      return { id: contentId, status: transition.status, version: expectedVersion + 1 }
    })
  }

  async function saveKnowledgeProduct(caller, input = {}) {
    const authorization = await admin(caller)
    const contentId = requiredUuid(input.contentId)
    const productId = input.productId ? requiredUuid(input.productId) : createId()
    const expectedVersion = input.productId ? positiveInteger(input.expectedVersion) : 0
    const priceCents = input.priceCents === undefined || input.priceCents === null || input.priceCents === ''
      ? (catalogStage === 'TEST' ? defaultTestPriceCents : NaN)
      : boundedInteger(input.priceCents, NaN, 1, 10_000_000)
    if (!Number.isInteger(priceCents)) throw codeError('VALIDATION_FAILED')
    const name = optionalText(input.name, 100) || '单内容解锁'
    const status = optionalEnum(input.status, ['DRAFT', 'ACTIVE', 'INACTIVE']) || 'DRAFT'
    const unlockDays = nullableInteger(input.unlockDays, 1, 3660)
    const refundPolicy = optionalEnum(input.refundPolicy, ['BEFORE_ACCESS', 'NON_REFUNDABLE']) || 'BEFORE_ACCESS'
    const refundWindowHours = boundedInteger(input.refundWindowHours, 24, 0, 720)
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const content = await tx.one(
        `SELECT access_type, status FROM mip_knowledge_contents
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [context.appId, contentId],
      )
      if (!content) throw codeError('NOT_FOUND')
      if (content.access_type !== 'MEMBER_OR_PAID') throw codeError('INVALID_STATE')
      if (input.productId) {
        const current = await locked(tx, 'mip_knowledge_products', context.appId, productId)
        versionMatch(current, expectedVersion)
        if (current.content_id !== contentId || current.catalog_stage !== catalogStage) throw codeError('CONFLICT')
        await tx.query(
          `UPDATE mip_knowledge_products SET name = ?, price_cents = ?, unlock_days = ?,
            refund_policy = ?, refund_window_hours = ?, status = ?, updated_by_user_id = ?,
            version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
          [name, priceCents, unlockDays, refundPolicy, refundWindowHours, status, context.userId,
            context.appId, productId, expectedVersion],
        )
      }
      else {
        await tx.query(
          `INSERT INTO mip_knowledge_products (
            id, app_id, content_id, catalog_stage, name, price_cents, currency,
            unlock_days, refund_policy, refund_window_hours, status, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?)`,
          [productId, context.appId, contentId, catalogStage, name, priceCents,
            unlockDays, refundPolicy, refundWindowHours, status, context.userId],
        )
      }
      await audit(tx, context, 'admin.knowledge.product.save', 'KNOWLEDGE_PRODUCT', productId, {
        contentId, catalogStage, priceCents, status,
      })
      return { id: productId, catalogStage, priceCents, status, version: input.productId ? expectedVersion + 1 : 1 }
    })
  }

  async function moderateKnowledgeComment(caller, input = {}) {
    const authorization = await admin(caller)
    const commentId = requiredUuid(input.commentId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    const decision = optionalEnum(input.decision, ['PUBLISH', 'HIDE'])
    const reason = requiredText(input.reason, 300)
    if (!decision) throw codeError('VALIDATION_FAILED')
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const current = await lockedKnowledgeComment(tx, context.appId, commentId)
      versionMatch(current, expectedVersion)
      if (!['PENDING', 'PUBLISHED', 'HIDDEN'].includes(current.status)) throw codeError('INVALID_STATE')
      const next = decision === 'PUBLISH' ? 'PUBLISHED' : 'HIDDEN'
      await tx.query(
        `UPDATE mip_content_comments SET status = ?, moderated_by_user_id = ?,
          moderation_reason = ?, moderated_at = UTC_TIMESTAMP(3),
          published_at = CASE WHEN ? = 'PUBLISHED' THEN COALESCE(published_at, UTC_TIMESTAMP(3)) ELSE published_at END,
          version = version + 1 WHERE app_id = ? AND id = ? AND version = ?`,
        [next, context.userId, reason, next, context.appId, commentId, expectedVersion],
      )
      await audit(tx, context, 'admin.knowledge.comment.moderate', 'CONTENT_COMMENT', commentId, { decision, reason })
      return { id: commentId, status: next, version: expectedVersion + 1 }
    })
  }

  async function closeKnowledgeCommentReport(caller, input = {}) {
    const authorization = await admin(caller)
    const reportId = requiredUuid(input.reportId)
    const expectedVersion = positiveInteger(input.expectedVersion)
    const status = optionalEnum(input.status, ['RESOLVED', 'DISMISSED'])
    const reason = requiredText(input.reason, 300)
    if (!status) throw codeError('VALIDATION_FAILED')
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const current = await lockedKnowledgeReport(tx, context.appId, reportId)
      versionMatch(current, expectedVersion)
      if (!['PENDING', 'REVIEWING'].includes(current.status)) throw codeError('INVALID_STATE')
      await tx.query(
        `UPDATE mip_content_comment_reports SET status = ?, reviewed_by_user_id = ?,
          reviewed_at = UTC_TIMESTAMP(3), resolution_reason = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [status, context.userId, reason, context.appId, reportId, expectedVersion],
      )
      await audit(tx, context, 'admin.knowledge.comment_report.close', 'CONTENT_COMMENT_REPORT', reportId, { status, reason })
      return { id: reportId, status, version: expectedVersion + 1 }
    })
  }

  async function runKnowledgeIngestion(caller, input = {}) {
    const authorization = await admin(caller)
    const sourceId = requiredUuid(input.sourceId)
    const categoryId = requiredUuid(input.categoryId)
    const idempotencyKey = requiredKey(input.idempotencyKey)
    let items = Array.isArray(input.items) ? input.items : []
    if (!items.length) {
      if (typeof fetchSource !== 'function') throw codeError('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
      const source = await database.one(
        `SELECT id, source_type, endpoint_url, fetch_config_json, status
         FROM mip_knowledge_sources WHERE app_id = ? AND id = ?`,
        [authorization.appId, sourceId],
      )
      if (!source || source.status !== 'ACTIVE' || source.source_type === 'MANUAL') {
        throw codeError('KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE')
      }
      try {
        items = await fetchSource(source)
      }
      catch (error) {
        const errorCode = ['KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE', 'KNOWLEDGE_SOURCE_RESPONSE_INVALID']
          .includes(error?.message) ? error.message : 'KNOWLEDGE_SOURCE_FETCH_UNAVAILABLE'
        await recordFailedIngestion(database, authorization, {
          sourceId, categoryId, idempotencyKey, errorCode, createId,
          caller, lockAdmin,
        })
        throw codeError(errorCode)
      }
    }
    const normalized = items.slice(0, 50)
      .map(item => normalizeIngestionItem(item, { allowedHosts: webviewAllowedHosts }))
    if (!normalized.length) throw codeError('VALIDATION_FAILED')
    const requestHash = createHash('sha256').update(JSON.stringify({ sourceId, categoryId, items: normalized })).digest('hex')
    return database.transaction(async (tx) => {
      const context = await lockAdmin(tx, caller, authorization.userId)
      const replay = await tx.one(
        `SELECT id, request_hash, status, fetched_count, created_count, duplicate_count, rejected_count
         FROM mip_knowledge_ingestion_runs
         WHERE app_id = ? AND source_id = ? AND idempotency_key = ? FOR UPDATE`,
        [context.appId, sourceId, idempotencyKey],
      )
      if (replay) {
        if (replay.request_hash !== requestHash) throw codeError('IDEMPOTENCY_CONFLICT')
        return runDto(replay)
      }
      await assertCategoryAndSource(tx, context.appId, categoryId, sourceId)
      const runId = createId()
      await tx.query(
        `INSERT INTO mip_knowledge_ingestion_runs (
          id, app_id, source_id, idempotency_key, request_hash, trigger_type,
          status, fetched_count, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'RUNNING', ?, ?)`,
        [runId, context.appId, sourceId, idempotencyKey, requestHash, normalized.length, context.userId],
      )
      let created = 0
      let duplicate = 0
      let rejected = 0
      for (const item of normalized) {
        const stored = await tx.one(
          `SELECT id FROM mip_knowledge_contents
           WHERE app_id = ? AND (source_content_hash = ?
             OR (source_id = ? AND source_external_id = ?)) LIMIT 1 FOR UPDATE`,
          [context.appId, item.contentHash, sourceId, item.externalId],
        )
        const ingestionItemId = createId()
        if (stored) {
          duplicate += 1
          await insertIngestionItem(tx, context.appId, ingestionItemId, runId, sourceId,
            item, 'DUPLICATE', stored.id, null)
          continue
        }
        const deliveryInvalid = ['WEB', 'VIDEO'].includes(item.contentType)
          ? !item.externalUrl
          : item.contentType === 'PRIVATE_CHANNEL' || !item.bodyText
        if (!item.title || deliveryInvalid) {
          rejected += 1
          await insertIngestionItem(tx, context.appId, ingestionItemId, runId, sourceId,
            item, 'REJECTED', null, 'INVALID_ITEM')
          continue
        }
        const contentId = createId()
        await tx.query(
          `INSERT INTO mip_knowledge_contents (
            id, app_id, source_id, category_id, content_type, title, summary, body_text,
            external_url, author_name, access_type, source_external_id, source_content_hash,
            source_published_at, status, content_safety_status, created_by_user_id, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FREE', ?, ?, ?,
            'PENDING_REVIEW', 'PENDING', ?, ?)`,
          [contentId, context.appId, sourceId, categoryId, item.contentType, item.title,
            item.summary, item.bodyText, item.externalUrl, item.authorName, item.externalId,
            item.contentHash, item.publishedAt, context.userId, context.userId],
        )
        await insertIngestionItem(tx, context.appId, ingestionItemId, runId, sourceId,
          item, 'CREATED', contentId, null)
        created += 1
      }
      await tx.query(
        `UPDATE mip_knowledge_ingestion_runs SET status = 'COMPLETED', created_count = ?,
          duplicate_count = ?, rejected_count = ?, completed_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND status = 'RUNNING'`,
        [created, duplicate, rejected, context.appId, runId],
      )
      await tx.query(
        `UPDATE mip_knowledge_sources SET last_fetched_at = UTC_TIMESTAMP(3),
          updated_by_user_id = ?, version = version + 1 WHERE app_id = ? AND id = ?`,
        [context.userId, context.appId, sourceId],
      )
      await audit(tx, context, 'admin.knowledge.ingestion.run', 'KNOWLEDGE_INGESTION_RUN', runId, {
        sourceId, fetched: normalized.length, created, duplicate, rejected,
      })
      return {
        id: runId,
        status: 'COMPLETED',
        fetchedCount: normalized.length,
        createdCount: created,
        duplicateCount: duplicate,
        rejectedCount: rejected,
      }
    })
  }

  return {
    closeKnowledgeCommentReport,
    getKnowledgeAdminContent,
    listKnowledgeAdmin,
    moderateKnowledgeComment,
    reviewKnowledgeContent,
    runKnowledgeIngestion,
    saveKnowledgeCategory,
    saveKnowledgeContent,
    saveKnowledgeProduct,
    saveKnowledgeSource,
  }
}

async function recordFailedIngestion(database, authorization, input) {
  const requestHash = createHash('sha256').update(JSON.stringify({
    sourceId: input.sourceId,
    categoryId: input.categoryId,
    fetch: true,
  })).digest('hex')
  return database.transaction(async (tx) => {
    const context = await input.lockAdmin(tx, input.caller, authorization.userId)
    const replay = await tx.one(
      `SELECT id, request_hash FROM mip_knowledge_ingestion_runs
       WHERE app_id = ? AND source_id = ? AND idempotency_key = ? FOR UPDATE`,
      [context.appId, input.sourceId, input.idempotencyKey],
    )
    if (replay) {
      if (replay.request_hash !== requestHash) throw codeError('IDEMPOTENCY_CONFLICT')
      return replay.id
    }
    await assertCategoryAndSource(tx, context.appId, input.categoryId, input.sourceId)
    const runId = input.createId()
    await tx.query(
      `INSERT INTO mip_knowledge_ingestion_runs (
        id, app_id, source_id, idempotency_key, request_hash, trigger_type,
        status, fetched_count, last_error_code, completed_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'FAILED', 0, ?, UTC_TIMESTAMP(3), ?)`,
      [runId, context.appId, input.sourceId, input.idempotencyKey, requestHash,
        input.errorCode, context.userId],
    )
    await audit(tx, context, 'admin.knowledge.ingestion.failed', 'KNOWLEDGE_INGESTION_RUN', runId, {
      sourceId: input.sourceId, errorCode: input.errorCode,
    })
    return runId
  })
}

function normalizeSource(input, allowedHosts) {
  const id = input.sourceId ? requiredUuid(input.sourceId) : null
  const sourceType = optionalEnum(input.sourceType, ['MANUAL', 'JSON_FEED', 'RSS']) || 'MANUAL'
  const endpointUrl = sourceType === 'MANUAL'
    ? null
    : safeExternalUrl(input.endpointUrl, { allowedHosts })
  return {
    id,
    expectedVersion: id ? positiveInteger(input.expectedVersion) : 0,
    sourceKey: stableKey(input.sourceKey),
    name: requiredText(input.name, 100),
    sourceType,
    endpointUrl,
    status: optionalEnum(input.status, ['ACTIVE', 'INACTIVE']) || 'ACTIVE',
    fetchConfig: normalizeFetchConfig(input.fetchConfig),
  }
}

function normalizeCategory(input) {
  const id = input.categoryId ? requiredUuid(input.categoryId) : null
  return {
    id,
    expectedVersion: id ? positiveInteger(input.expectedVersion) : 0,
    categoryKey: stableKey(input.categoryKey),
    name: requiredText(input.name, 80),
    summary: optionalText(input.summary, 300),
    sortOrder: boundedInteger(input.sortOrder, 0, -100000, 100000),
    status: optionalEnum(input.status, ['ACTIVE', 'INACTIVE']) || 'ACTIVE',
  }
}

function normalizeContent(input, allowedHosts) {
  const id = input.contentId ? requiredUuid(input.contentId) : null
  const contentType = optionalEnum(input.contentType, [...CONTENT_TYPES])
  const accessType = optionalEnum(input.accessType, [...ACCESS_TYPES])
  if (!contentType || !accessType) throw codeError('VALIDATION_FAILED')
  const bodyText = optionalText(input.bodyText, 100000) || null
  const externalUrl = input.externalUrl ? safeExternalUrl(input.externalUrl, { allowedHosts }) : null
  if (['ARTICLE', 'HOT_NEWS', 'EXPERT_SHARE'].includes(contentType) && !bodyText) throw codeError('VALIDATION_FAILED')
  const channelFinderUserName = optionalAsciiToken(input.channelFinderUserName, 64)
  const channelFeedId = optionalAsciiToken(input.channelFeedId, 128)
  if (['WEB', 'VIDEO'].includes(contentType) && !externalUrl) throw codeError('VALIDATION_FAILED')
  if (contentType === 'PRIVATE_CHANNEL' && (!channelFinderUserName || !channelFeedId)) {
    throw codeError('VALIDATION_FAILED')
  }
  return {
    id,
    expectedVersion: id ? positiveInteger(input.expectedVersion) : 0,
    sourceId: input.sourceId ? requiredUuid(input.sourceId) : null,
    categoryId: requiredUuid(input.categoryId),
    contentType,
    title: requiredText(input.title, 160),
    summary: requiredText(input.summary, 500),
    bodyText,
    externalUrl,
    channelFinderUserName: contentType === 'PRIVATE_CHANNEL' ? channelFinderUserName : null,
    channelFeedId: contentType === 'PRIVATE_CHANNEL' ? channelFeedId : null,
    coverAssetId: input.coverAssetId ? requiredUuid(input.coverAssetId) : null,
    authorName: optionalText(input.authorName, 100) || null,
    accessType,
    commentsEnabled: input.commentsEnabled !== false,
    moderationMode: input.moderationMode === 'REVIEW' ? 'REVIEW' : 'AUTO',
  }
}

function normalizeIngestionItem(value, options = {}) {
  const externalId = String(value?.externalId || '').trim().slice(0, 160)
  const title = String(value?.title || '').trim().slice(0, 160)
  const summary = String(value?.summary || title).trim().slice(0, 500)
  const bodyText = String(value?.bodyText || '').trim().slice(0, 100000) || null
  let externalUrl = null
  try {
    externalUrl = value?.externalUrl
      ? safeExternalUrl(value.externalUrl, { allowedHosts: options.allowedHosts })
      : null
  }
  catch { externalUrl = null }
  const contentType = CONTENT_TYPES.has(String(value?.contentType)) ? String(value.contentType) : 'HOT_NEWS'
  const authorName = String(value?.authorName || '').trim().slice(0, 100) || null
  const publishedAt = validDate(value?.publishedAt)
  const contentHash = createHash('sha256').update(JSON.stringify({ title, bodyText, externalUrl })).digest('hex')
  return {
    externalId: externalId || contentHash,
    title,
    summary,
    bodyText: bodyText || (contentType === 'HOT_NEWS' ? summary : null),
    externalUrl,
    contentType,
    authorName,
    publishedAt,
    contentHash,
  }
}

function knowledgeTransition(current, decision, reason, safety, reviewerUserId) {
  const now = new Date()
  if (decision === 'SUBMIT' && ['DRAFT', 'REJECTED'].includes(current.status)) {
    return { status: 'PENDING_REVIEW', safety: current.content_safety_status, reviewer: null,
      reason: null, reviewedAt: null, publishedAt: null, withdrawnAt: null }
  }
  if (decision === 'APPROVE' && current.status === 'PENDING_REVIEW') {
    return { status: 'DRAFT', safety: safety || 'PASSED', reviewer: reviewerUserId,
      reason: reason || 'APPROVED', reviewedAt: now, publishedAt: null, withdrawnAt: null }
  }
  if (decision === 'REJECT' && current.status === 'PENDING_REVIEW' && reason) {
    return { status: 'REJECTED', safety: current.content_safety_status, reviewer: reviewerUserId,
      reason, reviewedAt: now, publishedAt: null, withdrawnAt: null }
  }
  if (decision === 'PUBLISH' && current.status === 'DRAFT'
    && current.content_safety_status === 'PASSED' && current.reviewed_at) {
    return { status: 'PUBLISHED', safety: 'PASSED', reviewer: current.reviewed_by_user_id,
      reason: current.review_reason, reviewedAt: current.reviewed_at, publishedAt: now, withdrawnAt: null }
  }
  if (decision === 'WITHDRAW' && current.status === 'PUBLISHED' && reason) {
    return { status: 'WITHDRAWN', safety: current.content_safety_status, reviewer: current.reviewed_by_user_id,
      reason: current.review_reason, reviewedAt: current.reviewed_at, publishedAt: current.published_at,
      withdrawnAt: now }
  }
  throw codeError('INVALID_STATE')
}

async function assertCategoryAndSource(tx, appId, categoryId, sourceId) {
  const category = await tx.one(
    `SELECT id FROM mip_knowledge_categories WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
    [appId, categoryId],
  )
  if (!category) throw codeError('VALIDATION_FAILED')
  if (sourceId) {
    const source = await tx.one(
      `SELECT id FROM mip_knowledge_sources WHERE app_id = ? AND id = ? AND status = 'ACTIVE' FOR UPDATE`,
      [appId, sourceId],
    )
    if (!source) throw codeError('VALIDATION_FAILED')
  }
}

async function ensureCommentSettings(tx, context, contentId, enabled, mode) {
  await tx.query(
    `INSERT INTO mip_content_comment_settings (
      app_id, target_type, target_id, comments_enabled, moderation_mode, updated_by_user_id
    ) VALUES (?, 'KNOWLEDGE', ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE comments_enabled = VALUES(comments_enabled),
      moderation_mode = VALUES(moderation_mode), updated_by_user_id = VALUES(updated_by_user_id),
      version = version + 1`,
    [context.appId, contentId, enabled ? 1 : 0, mode, context.userId],
  )
}

async function insertIngestionItem(tx, appId, id, runId, sourceId, item, result, contentId, errorCode) {
  await tx.query(
    `INSERT INTO mip_knowledge_ingestion_items (
      id, app_id, run_id, source_id, source_external_id, source_url,
      content_hash, result, content_id, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, appId, runId, sourceId, item.externalId, item.externalUrl,
      item.contentHash, result, contentId, errorCode],
  )
}

async function locked(tx, table, appId, id) {
  const allowed = new Set([
    'mip_knowledge_sources', 'mip_knowledge_categories', 'mip_knowledge_contents',
    'mip_knowledge_products',
  ])
  if (!allowed.has(table)) throw codeError('VALIDATION_FAILED')
  const row = await tx.one(`SELECT * FROM ${table} WHERE app_id = ? AND id = ? FOR UPDATE`, [appId, id])
  if (!row) throw codeError('NOT_FOUND')
  return row
}

function assertKnowledgeDeliveryUrl(content, allowedHosts) {
  if (['WEB', 'VIDEO'].includes(content.content_type)) {
    safeExternalUrl(content.external_url, { allowedHosts })
  }
}

async function lockedKnowledgeComment(tx, appId, id) {
  const row = await tx.one(
    `SELECT * FROM mip_content_comments
     WHERE app_id = ? AND id = ? AND target_type = 'KNOWLEDGE' FOR UPDATE`,
    [appId, id],
  )
  if (!row) throw codeError('NOT_FOUND')
  return row
}

async function lockedKnowledgeReport(tx, appId, id) {
  const row = await tx.one(
    `SELECT report.*
     FROM mip_content_comment_reports report
     INNER JOIN mip_content_comments comment
       ON comment.app_id = report.app_id AND comment.id = report.comment_id
        AND comment.target_type = 'KNOWLEDGE'
     WHERE report.app_id = ? AND report.id = ? FOR UPDATE`,
    [appId, id],
  )
  if (!row) throw codeError('NOT_FOUND')
  return row
}

function versionMatch(row, expected) {
  if (Number(row.version) !== Number(expected)) throw codeError('CONFLICT')
}

async function appendOutbox(tx, appId, aggregateId, aggregateType, eventType, sourceVersion) {
  await tx.query(
    `INSERT INTO mip_outbox_events (
      id, app_id, aggregate_type, aggregate_id, event_type, source_version, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, JSON_OBJECT())`,
    [randomUUID(), appId, aggregateType, aggregateId, eventType, sourceVersion],
  )
}

async function audit(tx, context, action, resourceType, resourceId, metadata) {
  await tx.query(
    `INSERT INTO mip_audit_logs (
      app_id, actor_user_id, actor_type, scope_type, scope_id, action,
      resource_type, resource_id, effective_role, metadata_json
    ) VALUES (?, ?, 'ADMIN', 'PLATFORM', NULL, ?, ?, ?, ?, ?)`,
    [context.appId, context.userId, action, resourceType, resourceId,
      context.roleKey, JSON.stringify(metadata || {})],
  )
}

function sourceDto(row) {
  return { id: row.id, sourceKey: row.source_key, name: row.name, sourceType: row.source_type,
    endpointUrl: row.endpoint_url || '', status: row.status, fetchConfig: json(row.fetch_config_json),
    lastFetchedAt: iso(row.last_fetched_at), version: Number(row.version) }
}

function categoryAdminDto(row) {
  return { id: row.id, categoryKey: row.category_key, name: row.name, summary: row.summary || '',
    sortOrder: Number(row.sort_order), status: row.status, contentCount: Number(row.content_count || 0),
    version: Number(row.version) }
}

function contentAdminDto(row) {
  return { id: row.id, title: row.title, summary: row.summary, contentType: row.content_type,
    accessType: row.access_type, status: row.status, contentSafetyStatus: row.content_safety_status,
    authorName: row.author_name || '', category: { id: row.category_id, name: row.category_name },
    source: row.source_id ? { id: row.source_id, name: row.source_name } : null,
    product: row.product_id ? { id: row.product_id, name: row.product_name,
      catalogStage: row.catalog_stage, priceCents: Number(row.price_cents), currency: row.currency,
      status: row.product_status, unlockDays: row.unlock_days === null ? null : Number(row.unlock_days),
      refundPolicy: row.refund_policy, refundWindowHours: Number(row.refund_window_hours),
      version: Number(row.product_version) } : null,
    reviewedAt: iso(row.reviewed_at), publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at), version: Number(row.version) }
}

function contentAdminDetailDto(row) {
  return { ...contentAdminDto(row), bodyText: row.body_text || '', externalUrl: row.external_url || '',
    channelFinderUserName: row.channel_finder_username || '', channelFeedId: row.channel_feed_id || '',
    coverAssetId: row.cover_asset_id || '', commentsEnabled: Boolean(row.comments_enabled),
    moderationMode: row.moderation_mode, settingsVersion: Number(row.settings_version),
    reviewReason: row.review_reason || '', reviewedAt: iso(row.reviewed_at) }
}

function commentAdminDto(row) {
  return { id: row.id, contentId: row.content_id, contentTitle: row.content_title,
    authorNickname: row.author_nickname || 'MIP 用户', body: row.body, status: row.status,
    reportCount: Number(row.report_count || 0), version: Number(row.version), createdAt: iso(row.created_at) }
}

function reportAdminDto(row) {
  return { id: row.id, commentId: row.comment_id, contentId: row.content_id,
    contentTitle: row.content_title, reporterNickname: row.reporter_nickname || 'MIP 用户',
    category: row.category, description: row.description || '', status: row.status,
    resolutionReason: row.resolution_reason || '', version: Number(row.version), createdAt: iso(row.created_at) }
}

function runDto(row) {
  return { id: row.id, sourceId: row.source_id, sourceName: row.source_name || '',
    triggerType: row.trigger_type, status: row.status, fetchedCount: Number(row.fetched_count || 0),
    createdCount: Number(row.created_count || 0), duplicateCount: Number(row.duplicate_count || 0),
    rejectedCount: Number(row.rejected_count || 0), lastErrorCode: row.last_error_code || '',
    startedAt: iso(row.started_at), completedAt: iso(row.completed_at) }
}

function normalizeFetchConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  if (typeof value.itemsPath === 'string' && /^[A-Za-z0-9_.]{1,80}$/.test(value.itemsPath)) {
    result.itemsPath = value.itemsPath
  }
  return result
}

function safeExternalUrl(value, options = {}) {
  let url
  try { url = new URL(String(value || '').trim()) }
  catch { throw codeError('VALIDATION_FAILED') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw codeError('VALIDATION_FAILED')
  }
  const host = stripBrackets(url.hostname.toLowerCase())
  const allowedHosts = configuredHosts(options.allowedHosts)
  if (!allowedHosts.size || net.isIP(host) || !allowedHosts.has(host)
    || url.search.length > 512 || [...url.searchParams].length > 20
    || [...url.searchParams].some(([key, value]) => key.length > 64 || value.length > 256)) {
    throw codeError('VALIDATION_FAILED')
  }
  return url.toString()
}

function configuredHosts(value) {
  const values = value instanceof Set || Array.isArray(value)
    ? [...value]
    : String(value || '').split(',')
  const result = new Set()
  for (const item of values) {
    const host = stripBrackets(String(item || '').trim().toLowerCase())
    if (!host) continue
    if (net.isIP(host) || host.includes('/') || host.includes(':')
      || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
      throw codeError('KNOWLEDGE_HOST_CONFIG_INVALID')
    }
    result.add(host)
  }
  return result
}

function stripBrackets(value) {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function requiredUuid(value) {
  const text = String(value || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw codeError('VALIDATION_FAILED')
  }
  return text
}

function requiredText(value, maximum) {
  const text = String(value || '').trim()
  if (!text || text.length > maximum) throw codeError('VALIDATION_FAILED')
  return text
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === '') return ''
  const text = String(value).trim()
  if (text.length > maximum) throw codeError('VALIDATION_FAILED')
  return text
}

function stableKey(value) {
  const text = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(text)) throw codeError('VALIDATION_FAILED')
  return text
}

function optionalAsciiToken(value, maximum) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (!text || text.length > maximum || !/^[A-Za-z0-9_@.-]+$/.test(text)) {
    throw codeError('VALIDATION_FAILED')
  }
  return text
}

function requiredKey(value) {
  const text = String(value || '').trim()
  if (text.length < 12 || text.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(text)) {
    throw codeError('VALIDATION_FAILED')
  }
  return text
}

function positiveInteger(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw codeError('VALIDATION_FAILED')
  return number
}

function nullableInteger(value, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null
  return boundedInteger(value, NaN, minimum, maximum)
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback
}

function optionalEnum(value, choices) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).toUpperCase()
  return choices.includes(text) ? text : null
}

function pageLimit(value) {
  return boundedInteger(value, 50, 1, 100)
}

function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function json(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') }
  catch { return {} }
}

function iso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function codeError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

module.exports = {
  configuredHosts,
  createKnowledgeAdminService,
  normalizeIngestionItem,
  safeExternalUrl,
}
