'use strict'

const { randomUUID } = require('node:crypto')
const { confirmProfileAiDraft } = require('./ai-confirmation')
const { createAccountClosureRepository } = require('./account-closure')

function createIdentityRepository(database, options = {}) {
  const id = options.id || randomUUID
  const allowUnionRebind = options.allowUnionRebind === true
  const accountClosure = createAccountClosureRepository(database, options)

  async function ensureMembershipChain(tx, appId, userId) {
    await tx.query(
      `INSERT INTO mip_membership_chains (
         app_id, user_id, version, created_at, updated_at
       )
       SELECT membership_user.app_id, membership_user.id, 1,
              UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
       FROM mip_users membership_user
       WHERE membership_user.app_id = ? AND membership_user.id = ?
       ON DUPLICATE KEY UPDATE user_id = mip_membership_chains.user_id`,
      [appId, userId],
    )
  }

  async function findUserByIdentity(caller, adapter = database) {
    return adapter.one(
      `SELECT u.id, u.status, u.primary_branch_id, u.version,
              i.id AS identity_id, i.union_identity_key
       FROM mip_user_identities i
       INNER JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
       WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM'
         AND (i.identity_key = ? OR i.closed_identity_key = ?)`,
      [caller.appId, caller.identityKey, caller.identityKey],
    )
  }

  async function touchIdentity(caller, existing) {
    if (existing.status === 'CLOSED') {
      return existing
    }
    return database.transaction(async (tx) => {
      const identity = await tx.one(
        `SELECT id, user_id, identity_key, closed_identity_key, union_identity_key
         FROM mip_user_identities
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, existing.identity_id],
      )
      if (!identity) throw new Error('AUTH_REQUIRED')
      const user = await tx.one(
        `SELECT id, status, primary_branch_id, version
         FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [caller.appId, identity.user_id],
      )
      if (!user) throw new Error('AUTH_REQUIRED')
      if (user.status === 'CLOSED' || identity.closed_identity_key) {
        return { ...user, identity_id: identity.id, union_identity_key: identity.union_identity_key }
      }
      if (identity.identity_key !== caller.identityKey) throw new Error('AUTH_REQUIRED')
      if (caller.unionIdentityKey
        && identity.union_identity_key
        && identity.union_identity_key !== caller.unionIdentityKey) {
        throw new Error('IDENTITY_UNION_CONFLICT')
      }
      await ensureMembershipChain(tx, caller.appId, user.id)
      const update = await tx.query(
        `UPDATE mip_user_identities
         SET union_identity_key = COALESCE(union_identity_key, ?),
             last_authenticated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND user_id = ?
           AND identity_key = ? AND closed_identity_key IS NULL`,
        [caller.unionIdentityKey || null, caller.appId, identity.id,
          identity.user_id, caller.identityKey],
      )
      if (Number(update.affectedRows) !== 1) throw new Error('AUTH_REQUIRED')
      return {
        ...user,
        identity_id: identity.id,
        union_identity_key: identity.union_identity_key || caller.unionIdentityKey || null,
      }
    })
  }

  async function rebindByUnionIdentity(caller) {
    if (!allowUnionRebind || !caller.unionIdentityKey) return null
    return database.transaction(async (tx) => {
      const existing = await tx.one(
        `SELECT u.id, u.status, u.primary_branch_id, u.version,
                i.id AS identity_id, i.union_identity_key
         FROM mip_user_identities i
         INNER JOIN mip_users u ON u.app_id = i.app_id AND u.id = i.user_id
         WHERE i.app_id = ? AND i.provider = 'WECHAT_MINIPROGRAM'
           AND i.union_identity_key = ? FOR UPDATE`,
        [caller.appId, caller.unionIdentityKey],
      )
      if (!existing) return null
      if (existing.status === 'CLOSED') return existing
      await ensureMembershipChain(tx, caller.appId, existing.id)
      const update = await tx.query(
        `UPDATE mip_user_identities
         SET identity_key = ?, last_authenticated_at = UTC_TIMESTAMP(3)
         WHERE app_id = ? AND id = ? AND union_identity_key = ?`,
        [caller.identityKey, caller.appId, existing.identity_id, caller.unionIdentityKey],
      )
      if (Number(update.affectedRows) !== 1) {
        throw new Error('IDENTITY_REBIND_FAILED')
      }
      return existing
    })
  }

  async function ensureUser(caller) {
    const existing = await findUserByIdentity(caller)
    if (existing) {
      return touchIdentity(caller, existing)
    }

    const rebound = await rebindByUnionIdentity(caller)
    if (rebound) {
      return rebound
    }

    try {
      await database.transaction(async (tx) => {
        const userId = id()
        await tx.query(
          `INSERT INTO mip_users (id, app_id, status)
           VALUES (?, ?, 'ACTIVE')`,
          [userId, caller.appId],
        )
        await tx.query(
          `INSERT INTO mip_membership_chains (
             app_id, user_id, version, created_at, updated_at
           ) VALUES (?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [caller.appId, userId],
        )
        await tx.query(
          `INSERT INTO mip_user_identities (
             id, app_id, user_id, provider, identity_key, union_identity_key,
             last_authenticated_at
           ) VALUES (?, ?, ?, 'WECHAT_MINIPROGRAM', ?, ?, UTC_TIMESTAMP(3))`,
          [id(), caller.appId, userId, caller.identityKey, caller.unionIdentityKey || null],
        )
        await tx.query(
          `INSERT INTO mip_private_profiles (app_id, user_id)
           VALUES (?, ?)`,
          [caller.appId, userId],
        )
        await tx.query(
          `INSERT INTO mip_outbox_events (
             id, app_id, aggregate_type, aggregate_id, event_type,
             source_version, payload_json, status
           ) VALUES (?, ?, 'USER', ?, 'identity.user_registered', 1, JSON_OBJECT(), 'PENDING')`,
          [id(), caller.appId, userId],
        )
      })
    }
    catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') {
        throw error
      }
    }

    const created = await findUserByIdentity(caller)
    if (!created) {
      throw new Error('IDENTITY_CREATE_FAILED')
    }
    return touchIdentity(caller, created)
  }

  async function loadFacts(appId, userId) {
    const [user, profile, privateProfile, acceptances, profileTags, roles] = await Promise.all([
      database.one(
        `SELECT id, status, primary_branch_id, version
         FROM mip_users WHERE app_id = ? AND id = ?`,
        [appId, userId],
      ),
      database.one(
        `SELECT p.*, a.status AS avatar_status, a.cloud_file_id AS avatar_file_id
         FROM mip_profiles p
         LEFT JOIN mip_media_assets a
           ON a.app_id = p.app_id AND a.id = p.avatar_asset_id
         WHERE p.app_id = ? AND p.user_id = ?`,
        [appId, userId],
      ),
      database.one(
        `SELECT phone_verified_at
         FROM mip_private_profiles WHERE app_id = ? AND user_id = ?`,
        [appId, userId],
      ),
      database.query(
        `SELECT agreement_key, agreement_version
         FROM mip_agreement_acceptances
         WHERE app_id = ? AND user_id = ?`,
        [appId, userId],
      ),
      database.query(
        `SELECT pt.tag_id, pt.relation
         FROM mip_profile_tags pt
         INNER JOIN mip_tags t ON t.app_id = pt.app_id AND t.id = pt.tag_id
         WHERE pt.app_id = ? AND pt.user_id = ? AND t.enabled = 1`,
        [appId, userId],
      ),
      database.query(
        `SELECT binding.scope_type, binding.scope_id, binding.role_key,
          CASE WHEN policy.policy_mode = 'CUSTOM' THEN policy.capabilities_json ELSE NULL END AS policy_capabilities_json
         FROM mip_admin_role_bindings binding
         LEFT JOIN mip_role_capability_policies policy
           ON policy.app_id = binding.app_id AND policy.role_key = binding.role_key
         WHERE binding.app_id = ? AND binding.user_id = ? AND binding.status = 'ACTIVE'`,
        [appId, userId],
      ),
    ])
    if (!user) {
      throw new Error('AUTH_REQUIRED')
    }
    return { user, profile, privateProfile, acceptances, profileTags, roles }
  }

  async function loadPublicProfile(appId, userId, viewerUserId = null) {
    const visibilitySql = viewerUserId
      ? `AND NOT EXISTS (
           SELECT 1 FROM mip_user_blocks visibility_block
           WHERE visibility_block.app_id = u.app_id
             AND visibility_block.status = 'ACTIVE'
             AND (
               (visibility_block.blocker_user_id = ? AND visibility_block.blocked_user_id = u.id)
               OR
               (visibility_block.blocker_user_id = u.id AND visibility_block.blocked_user_id = ?)
             )
         )`
      : ''
    const profile = await database.one(
      `SELECT p.nickname, p.identity_status, p.headline, p.introduction,
              p.companies_json, p.organizations_json, p.visibility_json,
              avatar.cloud_file_id AS avatar_file_id,
              branch.name AS branch_name, branch.city_name AS branch_city_name,
              EXISTS(
                SELECT 1 FROM mip_membership_entitlements entitlement
                WHERE entitlement.app_id = u.app_id AND entitlement.user_id = u.id
                  AND entitlement.status = 'ACTIVE'
                  AND entitlement.starts_at <= UTC_TIMESTAMP(3)
                  AND entitlement.ends_at > UTC_TIMESTAMP(3)
              ) AS is_player
       FROM mip_users u
       INNER JOIN mip_profiles p ON p.app_id = u.app_id AND p.user_id = u.id
       LEFT JOIN mip_media_assets avatar
         ON avatar.app_id = p.app_id AND avatar.id = p.avatar_asset_id AND avatar.status = 'READY'
       LEFT JOIN mip_city_branches branch
         ON branch.app_id = u.app_id AND branch.id = u.primary_branch_id AND branch.status = 'ACTIVE'
       WHERE u.app_id = ? AND u.id = ? AND u.status = 'ACTIVE'
         ${visibilitySql}
       LIMIT 1`,
      [appId, userId, ...(viewerUserId ? [viewerUserId, viewerUserId] : [])],
    )
    if (!profile) return null
    const tags = await database.query(
      `SELECT pt.relation, t.label
       FROM mip_profile_tags pt
       INNER JOIN mip_tags t ON t.app_id = pt.app_id AND t.id = pt.tag_id
       WHERE pt.app_id = ? AND pt.user_id = ? AND t.enabled = 1
         AND pt.relation IN ('PRIMARY_INDUSTRY', 'ABILITY')
       ORDER BY pt.relation, t.sort_order, t.id`,
      [appId, userId],
    )
    return { profile, tags }
  }

  async function acceptAgreements(appId, userId, agreements) {
    await database.transaction(async (tx) => {
      await requireActiveUserForUpdate(tx, appId, userId)
      for (const agreement of agreements) {
        try {
          await tx.query(
            `INSERT INTO mip_agreement_acceptances (
               id, app_id, user_id, agreement_key, agreement_version, source, evidence_hash
             ) VALUES (?, ?, ?, ?, ?, 'MINIPROGRAM_ACCESS', NULL)`,
            [id(), appId, userId, agreement.key, agreement.version],
          )
        }
        catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY') {
            throw error
          }
        }
      }
    })
  }

  async function bindPhone(appId, userId, protectedPhone) {
    await database.transaction(async (tx) => {
      await requireActiveUserForUpdate(tx, appId, userId)
      try {
        const result = await tx.query(
          `UPDATE mip_private_profiles SET
             phone_hash = ?, phone_ciphertext = ?, phone_verified_at = UTC_TIMESTAMP(3)
           WHERE app_id = ? AND user_id = ?`,
          [protectedPhone.phoneHash, protectedPhone.phoneCiphertext, appId, userId],
        )
        if (Number(result.affectedRows) !== 1) {
          throw new Error('PHONE_BIND_FAILED')
        }
      }
      catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
          throw new Error('PHONE_ALREADY_BOUND')
        }
        throw error
      }
    })
  }

  async function updateProfile(appId, userId, input) {
    await database.transaction(async (tx) => {
      const user = await tx.one(
        `SELECT id, status, primary_branch_id, version
         FROM mip_users WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, userId],
      )
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('FORBIDDEN')
      }
      let effectivePrimaryBranchId = user.primary_branch_id
      if (input.primaryBranchId) {
        if (Number(user.version) !== input.expectedUserVersion) {
          throw new Error('CONFLICT')
        }
        const branch = await tx.one(
          `SELECT id, status FROM mip_city_branches
           WHERE app_id = ? AND id = ? FOR UPDATE`,
          [appId, input.primaryBranchId],
        )
        if (!branch || branch.status !== 'ACTIVE') {
          throw new Error('BRANCH_NOT_FOUND')
        }
        await tx.query(
          `INSERT INTO mip_branch_memberships (app_id, branch_id, user_id, status, ended_at)
           VALUES (?, ?, ?, 'ACTIVE', NULL)
           ON DUPLICATE KEY UPDATE status = 'ACTIVE', ended_at = NULL`,
          [appId, input.primaryBranchId, userId],
        )
        if (user.primary_branch_id !== input.primaryBranchId) {
          const updateUser = await tx.query(
            `UPDATE mip_users SET primary_branch_id = ?, version = version + 1
             WHERE app_id = ? AND id = ? AND version = ?`,
            [input.primaryBranchId, appId, userId, input.expectedUserVersion],
          )
          if (Number(updateUser.affectedRows) !== 1) {
            throw new Error('CONFLICT')
          }
        }
        effectivePrimaryBranchId = input.primaryBranchId
      }
      const current = await tx.one(
        `SELECT version, avatar_asset_id FROM mip_profiles
         WHERE app_id = ? AND user_id = ? FOR UPDATE`,
        [appId, userId],
      )
      const currentVersion = Number(current?.version || 0)
      if (currentVersion !== input.expectedVersion) {
        throw new Error('CONFLICT')
      }

      const avatarAssetId = input.avatarAssetId === undefined
        ? (current?.avatar_asset_id || null)
        : input.avatarAssetId
      if (avatarAssetId) {
        const avatar = await tx.one(
          `SELECT id FROM mip_media_assets
           WHERE app_id = ? AND id = ? AND owner_user_id = ?
             AND purpose = 'AVATAR' AND status = 'READY'
           FOR UPDATE`,
          [appId, avatarAssetId, userId],
        )
        if (!avatar) {
          throw new Error('PROFILE_AVATAR_INVALID')
        }
      }

      const selections = [input.primaryIndustryTagId, ...input.abilityTagIds].filter(Boolean)
      await assertTagSelections(tx, appId, input.primaryIndustryTagId, input.abilityTagIds, selections)

      if (current) {
        const updateProfile = await tx.query(
          `UPDATE mip_profiles SET
             nickname = ?, avatar_asset_id = ?, identity_status = ?, headline = ?, introduction = ?,
             companies_json = ?, organizations_json = ?, visibility_json = ?, version = version + 1
           WHERE app_id = ? AND user_id = ? AND version = ?`,
          [
            input.nickname,
            avatarAssetId,
            input.identityStatus || null,
            input.headline || null,
            input.introduction || null,
            JSON.stringify(input.companies),
            JSON.stringify(input.organizations),
            JSON.stringify(input.visibility),
            appId,
            userId,
            input.expectedVersion,
          ],
        )
        if (Number(updateProfile.affectedRows) !== 1) {
          throw new Error('CONFLICT')
        }
      }
      else {
        await tx.query(
          `INSERT INTO mip_profiles (
             app_id, user_id, nickname, avatar_asset_id, identity_status, headline, introduction,
             companies_json, organizations_json, visibility_json, version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            appId,
            userId,
            input.nickname,
            avatarAssetId,
            input.identityStatus || null,
            input.headline || null,
            input.introduction || null,
            JSON.stringify(input.companies),
            JSON.stringify(input.organizations),
            JSON.stringify(input.visibility),
          ],
        )
      }

      await tx.query(
        `DELETE FROM mip_profile_tags
         WHERE app_id = ? AND user_id = ? AND relation IN ('PRIMARY_INDUSTRY', 'ABILITY')`,
        [appId, userId],
      )
      if (input.primaryIndustryTagId) {
        await tx.query(
          `INSERT INTO mip_profile_tags (app_id, user_id, tag_id, relation)
           VALUES (?, ?, ?, 'PRIMARY_INDUSTRY')`,
          [appId, userId, input.primaryIndustryTagId],
        )
      }
      for (const tagId of input.abilityTagIds) {
        await tx.query(
          `INSERT INTO mip_profile_tags (app_id, user_id, tag_id, relation)
           VALUES (?, ?, ?, 'ABILITY')`,
          [appId, userId, tagId],
        )
      }
      await recordProfileCompletion(tx, appId, userId, effectivePrimaryBranchId, id)
      await confirmProfileAiDraft(tx, {
        appId,
        userId,
        confirmation: input.aiConfirmation,
        profile: input,
      })
    })
  }

  async function listProfileTags(appId) {
    return database.query(
      `SELECT t.id, t.kind, t.parent_id, t.tag_key, t.label, t.selectable, t.popular
       FROM mip_tags t
       LEFT JOIN mip_tags parent
         ON parent.app_id = t.app_id AND parent.id = t.parent_id
       WHERE t.app_id = ? AND t.enabled = 1
         AND (
           (t.kind = 'ABILITY' AND t.selectable = 1)
           OR (
             t.kind = 'INDUSTRY'
             AND (
               (t.parent_id IS NULL AND t.selectable = 0)
               OR (
                 t.selectable = 1
                 AND parent.kind = 'INDUSTRY'
                 AND parent.parent_id IS NULL
                 AND parent.selectable = 0
                 AND parent.enabled = 1
               )
             )
           )
         )
       ORDER BY t.kind,
         COALESCE(parent.sort_order, t.sort_order),
         CASE WHEN t.parent_id IS NULL THEN 0 ELSE 1 END,
         t.sort_order, t.id`,
      [appId],
    )
  }

  async function listBranches(appId) {
    return database.query(
      `SELECT id, name, city_name, status
       FROM mip_city_branches
       WHERE app_id = ? AND status = 'ACTIVE'
       ORDER BY city_name, name, id`,
      [appId],
    )
  }

  async function loadEntitlement(appId, userId) {
    try {
      const row = await database.one(
        `SELECT status, starts_at, ends_at
         FROM mip_membership_entitlements
         WHERE app_id = ? AND user_id = ?
           AND status = 'ACTIVE'
           AND starts_at <= UTC_TIMESTAMP(3)
           AND ends_at > UTC_TIMESTAMP(3)
         ORDER BY ends_at DESC, id DESC
         LIMIT 1`,
        [appId, userId],
      )
      if (!row) {
        return { source: 'NONE', entitlement: null }
      }
      return {
        source: 'ENTITLEMENT',
        entitlement: {
          status: row.status,
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
        },
      }
    }
    catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE' || Number(error?.errno) === 1146) {
        return { source: 'UNAVAILABLE', entitlement: null }
      }
      throw error
    }
  }

  async function setPrimaryBranch(appId, userId, input) {
    await database.transaction(async (tx) => {
      const user = await tx.one(
        `SELECT id, status, version FROM mip_users
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, userId],
      )
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('FORBIDDEN')
      }
      if (Number(user.version) !== input.expectedVersion) {
        throw new Error('CONFLICT')
      }
      const branch = await tx.one(
        `SELECT id, status FROM mip_city_branches
         WHERE app_id = ? AND id = ? FOR UPDATE`,
        [appId, input.branchId],
      )
      if (!branch || branch.status !== 'ACTIVE') {
        throw new Error('BRANCH_NOT_FOUND')
      }
      await tx.query(
        `INSERT INTO mip_branch_memberships (app_id, branch_id, user_id, status, ended_at)
         VALUES (?, ?, ?, 'ACTIVE', NULL)
         ON DUPLICATE KEY UPDATE status = 'ACTIVE', ended_at = NULL`,
        [appId, input.branchId, userId],
      )
      const updateUser = await tx.query(
        `UPDATE mip_users SET primary_branch_id = ?, version = version + 1
         WHERE app_id = ? AND id = ? AND version = ?`,
        [input.branchId, appId, userId, input.expectedVersion],
      )
      if (Number(updateUser.affectedRows) !== 1) {
        throw new Error('CONFLICT')
      }
      await recordProfileCompletion(tx, appId, userId, input.branchId, id)
    })
  }

  return {
    acceptAgreements,
    bindPhone,
    closeAccount: accountClosure.closeAccount,
    ensureUser,
    findUserByIdentity,
    listBranches,
    loadEntitlement,
    listProfileTags,
    loadFacts,
    loadPublicProfile,
    setPrimaryBranch,
    updateProfile,
  }
}

async function requireActiveUserForUpdate(tx, appId, userId) {
  const user = await tx.one(
    `SELECT id, status FROM mip_users
     WHERE app_id = ? AND id = ? FOR UPDATE`,
    [appId, userId],
  )
  if (!user || user.status !== 'ACTIVE') throw new Error('FORBIDDEN')
  return user
}

function iso(value) {
  if (!value) {
    return ''
  }
  const result = new Date(value)
  return Number.isNaN(result.getTime()) ? '' : result.toISOString()
}

async function assertTagSelections(tx, appId, primaryIndustryTagId, abilityTagIds, selections) {
  if (!selections.length) {
    return
  }
  const placeholders = selections.map(() => '?').join(', ')
  const rows = await tx.query(
    `SELECT t.id, t.kind, t.selectable, t.parent_id,
            parent.kind AS parent_kind, parent.parent_id AS parent_parent_id,
            parent.selectable AS parent_selectable, parent.enabled AS parent_enabled
     FROM mip_tags t
     LEFT JOIN mip_tags parent
       ON parent.app_id = t.app_id AND parent.id = t.parent_id
     WHERE t.app_id = ? AND t.id IN (${placeholders}) AND t.enabled = 1`,
    [appId, ...selections],
  )
  const tags = new Map(rows.map(row => [row.id, row]))
  if (tags.size !== new Set(selections).size) {
    throw new Error('PROFILE_TAG_INVALID')
  }
  if (primaryIndustryTagId) {
    const primary = tags.get(primaryIndustryTagId)
    if (!isSelectableIndustry(primary)) {
      throw new Error('PROFILE_TAG_INVALID')
    }
  }
  if (abilityTagIds.some((tagId) => {
    const tag = tags.get(tagId)
    return tag?.kind !== 'ABILITY' || Number(tag.selectable) !== 1
  })) {
    throw new Error('PROFILE_TAG_INVALID')
  }
}

function isSelectableIndustry(tag) {
  return tag?.kind === 'INDUSTRY'
    && Number(tag.selectable) === 1
    && Boolean(tag.parent_id)
    && tag.parent_kind === 'INDUSTRY'
    && !tag.parent_parent_id
    && Number(tag.parent_selectable) === 0
    && Number(tag.parent_enabled) === 1
}

async function recordProfileCompletion(tx, appId, userId, primaryBranchId, createId) {
  if (!primaryBranchId) {
    return
  }
  const profile = await tx.one(
    `SELECT nickname, version FROM mip_profiles
     WHERE app_id = ? AND user_id = ?`,
    [appId, userId],
  )
  if (!profile?.nickname?.trim()) {
    return
  }
  const existing = await tx.one(
    `SELECT id FROM mip_outbox_events
     WHERE app_id = ? AND aggregate_type = 'USER' AND aggregate_id = ?
       AND event_type = 'identity.profile_completed'
     LIMIT 1`,
    [appId, userId],
  )
  if (existing) {
    return
  }
  await tx.query(
    `INSERT INTO mip_outbox_events (
       id, app_id, aggregate_type, aggregate_id, event_type,
       source_version, payload_json, status
     ) VALUES (?, ?, 'USER', ?, 'identity.profile_completed', ?, JSON_OBJECT(), 'PENDING')`,
    [createId(), appId, userId, Number(profile.version)],
  )
}

module.exports = { createIdentityRepository }
