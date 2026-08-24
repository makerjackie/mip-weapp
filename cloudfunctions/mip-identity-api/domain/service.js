'use strict'

const { projectGrants } = require('./capabilities')
const { normalizeAiConfirmation } = require('./ai-confirmation')

const ACCOUNT_CLOSURE_CONFIRMATION_PHRASE = '确认注销账号'

const defaultAgreements = [
  {
    key: 'SERVICE_AGREEMENT',
    label: '用户协议',
    version: 'draft-2026-08-24',
    documentPath: '/packages/member/user-agreement/index',
  },
  {
    key: 'PRIVACY_POLICY',
    label: '隐私政策',
    version: 'draft-2026-08-24',
    documentPath: '/packages/member/privacy/index',
  },
]

function createIdentityService(options) {
  const repository = options.repository
  const agreements = options.agreements || defaultAgreements
  const phoneResolver = options.phoneResolver
  const protectPhone = options.protectPhone
  const profileRefReader = options.profileRefReader
  const entitlementReader = options.entitlementReader || {
    load: (appId, userId) => repository.loadEntitlement(appId, userId),
  }

  async function getAccessSnapshot(caller) {
    const user = await repository.ensureUser(caller)
    const facts = await repository.loadFacts(caller.appId, user.id)
    const membership = await membershipProjection(entitlementReader, caller.appId, user.id)
    return snapshotDto(facts, agreements, membership)
  }

  async function acceptAgreements(caller, value) {
    const input = value?.input
    const submitted = Array.isArray(input?.agreements) ? input.agreements : []
    if (submitted.length !== agreements.length || agreements.some((requirement) => {
      return !submitted.some(item => item?.key === requirement.key && item?.version === requirement.version)
    })) {
      throw new Error('AGREEMENT_VERSION_CHANGED')
    }
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    await repository.acceptAgreements(caller.appId, user.id, agreements)
    return getAccessSnapshot(caller)
  }

  async function bindWechatPhone(caller, value) {
    const code = typeof value?.code === 'string' ? value.code.trim() : ''
    if (!code) {
      throw new Error('PHONE_CODE_REQUIRED')
    }
    if (typeof phoneResolver !== 'function' || typeof protectPhone !== 'function') {
      throw new Error('PHONE_SERVICE_UNAVAILABLE')
    }
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    const phoneInfo = await phoneResolver(code)
    await repository.bindPhone(caller.appId, user.id, protectPhone(phoneInfo, {
      appId: caller.appId,
      userId: user.id,
    }))
    return getAccessSnapshot(caller)
  }

  async function closeAccount(caller, value) {
    const input = normalizeAccountClosureInput(value?.input)
    const user = await repository.ensureUser(caller)
    return repository.closeAccount(caller, user, input)
  }

  async function getProfile(caller) {
    const user = await repository.ensureUser(caller)
    const facts = await repository.loadFacts(caller.appId, user.id)
    return profileDto(facts)
  }

  async function getPublicProfile(caller, value) {
    const profileRef = typeof value?.profileRef === 'string' ? value.profileRef.trim() : ''
    if (!profileRef || typeof profileRefReader !== 'function') {
      throw new Error('PUBLIC_PROFILE_NOT_FOUND')
    }
    const userId = profileRefReader(profileRef, caller.appId)
    const viewer = await repository.findUserByIdentity(caller)
    const facts = await repository.loadPublicProfile(caller.appId, userId, viewer?.id || null)
    if (!facts) {
      throw new Error('PUBLIC_PROFILE_NOT_FOUND')
    }
    return publicProfileDto(profileRef, facts, viewer?.id === userId)
  }

  async function updateProfile(caller, value) {
    const input = {
      ...normalizeProfileInput(value?.input),
      aiConfirmation: normalizeAiConfirmation(value?.input?.aiConfirmation),
    }
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    await repository.updateProfile(caller.appId, user.id, input)
    return getAccessSnapshot(caller)
  }

  async function listProfileTags(caller) {
    const rows = await repository.listProfileTags(caller.appId)
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      parentId: row.parent_id || undefined,
      key: row.tag_key,
      label: row.label,
      selectable: Boolean(row.selectable),
    }))
  }

  async function listBranches(caller) {
    return branchDtos(await repository.listBranches(caller.appId))
  }

  async function setPrimaryBranch(caller, value) {
    const input = value?.input
    if (!isUuid(input?.branchId)
      || !Number.isInteger(input?.expectedVersion)
      || input.expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED')
    }
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    await repository.setPrimaryBranch(caller.appId, user.id, input)
    const facts = await repository.loadFacts(caller.appId, user.id)
    return {
      branches: branchDtos(await repository.listBranches(caller.appId)),
      primaryBranchId: facts.user.primary_branch_id || undefined,
      userVersion: Number(facts.user.version),
    }
  }

  return {
    acceptAgreements,
    bindWechatPhone,
    closeAccount,
    getAccessSnapshot,
    getProfile,
    getPublicProfile,
    listBranches,
    listProfileTags,
    setPrimaryBranch,
    updateProfile,
  }
}

function normalizeAccountClosureInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VALIDATION_FAILED')
  }
  const confirmationPhrase = typeof value.confirmationPhrase === 'string'
    ? value.confirmationPhrase.trim()
    : ''
  if (confirmationPhrase !== ACCOUNT_CLOSURE_CONFIRMATION_PHRASE) {
    throw new Error('ACCOUNT_CLOSURE_CONFIRMATION_REQUIRED')
  }
  const expectedVersion = Number(value.expectedVersion)
  const idempotencyKey = typeof value.idempotencyKey === 'string'
    ? value.idempotencyKey.trim()
    : ''
  if (!Number.isInteger(expectedVersion)
    || expectedVersion < 1
    || !/^[A-Za-z0-9:_-]{12,128}$/.test(idempotencyKey)) {
    throw new Error('VALIDATION_FAILED')
  }
  return { confirmationPhrase, expectedVersion, idempotencyKey }
}

function assertActiveUser(user) {
  if (!user || user.status !== 'ACTIVE') {
    throw new Error('FORBIDDEN')
  }
}

function snapshotDto(facts, agreements, membership) {
  const accepted = new Set((facts.acceptances || []).map(
    item => `${item.agreement_key}:${item.agreement_version}`,
  ))
  return {
    authenticated: true,
    userId: facts.user.id,
    userVersion: Number(facts.user.version),
    userStatus: facts.user.status,
    phoneBound: Boolean(facts.privateProfile?.phone_verified_at),
    agreements: agreements.map(agreement => ({
      ...agreement,
      accepted: accepted.has(`${agreement.key}:${agreement.version}`),
    })),
    profile: profileDto(facts),
    primaryBranchId: facts.user.primary_branch_id || undefined,
    membership,
    grants: projectGrants(facts.roles),
  }
}

function profileDto(facts) {
  const profile = facts.profile
  const nickname = typeof profile?.nickname === 'string' ? profile.nickname.trim() : ''
  const missingFields = []
  if (!nickname) {
    missingFields.push('NICKNAME')
  }
  if (!facts.user.primary_branch_id) {
    missingFields.push('PRIMARY_BRANCH')
  }
  const profileTags = facts.profileTags || []
  return {
    exists: Boolean(profile),
    version: Number(profile?.version || 0),
    nickname,
    avatarBound: profile?.avatar_status === 'READY',
    avatarAssetId: profile?.avatar_asset_id || undefined,
    avatarUrl: profile?.avatar_status === 'READY' ? (profile.avatar_file_id || undefined) : undefined,
    identityStatus: profile?.identity_status || '',
    headline: profile?.headline || '',
    introduction: profile?.introduction || '',
    companies: jsonArray(profile?.companies_json),
    organizations: jsonArray(profile?.organizations_json),
    visibility: visibility(profile?.visibility_json),
    primaryIndustryTagId: profileTags.find(tag => tag.relation === 'PRIMARY_INDUSTRY')?.tag_id,
    abilityTagIds: profileTags
      .filter(tag => tag.relation === 'ABILITY')
      .map(tag => tag.tag_id),
    complete: missingFields.length === 0,
    missingFields,
  }
}

function publicProfileDto(profileRef, facts, isSelf = false) {
  const profile = facts.profile
  const allowed = visibility(profile.visibility_json)
  const tags = facts.tags || []
  const primaryIndustry = tags.find(tag => tag.relation === 'PRIMARY_INDUSTRY')
  const abilityTags = tags.filter(tag => tag.relation === 'ABILITY')
  return {
    profileRef,
    isSelf,
    ...(allowed.nickname && profile.nickname ? { nickname: String(profile.nickname).trim() } : {}),
    ...(allowed.avatar && profile.avatar_file_id ? { avatarUrl: profile.avatar_file_id } : {}),
    ...(allowed.identityStatus
      ? {
          userKind: Number(profile.is_player) === 1 ? 'PLAYER' : 'GUEST',
          ...(profile.identity_status ? { identityStatus: profile.identity_status } : {}),
        }
      : {}),
    ...(allowed.headline && profile.headline ? { headline: profile.headline } : {}),
    ...(allowed.introduction && profile.introduction ? { introduction: profile.introduction } : {}),
    ...(allowed.companies ? { companies: jsonArray(profile.companies_json) } : {}),
    ...(allowed.organizations ? { organizations: jsonArray(profile.organizations_json) } : {}),
    ...(allowed.industry && primaryIndustry ? { primaryIndustry: { label: primaryIndustry.label } } : {}),
    ...(allowed.abilities ? { abilities: abilityTags.map(tag => ({ label: tag.label })) } : {}),
    ...(allowed.primaryBranch && profile.branch_name
      ? { primaryBranch: { name: profile.branch_name, cityName: profile.branch_city_name || '' } }
      : {}),
  }
}

async function membershipProjection(reader, appId, userId) {
  const result = await reader.load(appId, userId)
  if (!result || result.source === 'UNAVAILABLE') {
    return { kind: 'GUEST', source: 'UNAVAILABLE' }
  }
  const entitlement = result.entitlement
  if (!entitlement) {
    return { kind: 'GUEST', source: 'NONE' }
  }
  const startsAt = Date.parse(entitlement.startsAt)
  const endsAt = Date.parse(entitlement.endsAt)
  const now = Date.now()
  const active = entitlement.status === 'ACTIVE'
    && Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && startsAt <= now
    && now < endsAt
  return {
    kind: active ? 'PLAYER' : 'GUEST',
    source: 'ENTITLEMENT',
    entitlement,
  }
}

function normalizeProfileInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VALIDATION_FAILED')
  }
  if (Object.prototype.hasOwnProperty.call(value, 'primaryIndustryTagIds')) {
    throw new Error('VALIDATION_FAILED')
  }
  const expectedVersion = Number(value.expectedVersion)
  const avatarAssetId = value.avatarAssetId === undefined
    ? undefined
    : String(value.avatarAssetId)
  const nickname = boundedText(value.nickname, 1, 64)
  const identityStatus = boundedText(value.identityStatus, 0, 32)
  const headline = boundedText(value.headline, 0, 160)
  const introduction = boundedText(value.introduction, 0, 600)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('VALIDATION_FAILED')
  }
  if (avatarAssetId !== undefined && !isUuid(avatarAssetId)) {
    throw new Error('VALIDATION_FAILED')
  }
  const companies = organizations(value.companies)
  const organizationList = organizations(value.organizations)
  const abilityTagIds = uniqueIds(value.abilityTagIds, 12)
  const primaryIndustryTagId = value.primaryIndustryTagId
    ? String(value.primaryIndustryTagId)
    : undefined
  const primaryBranchId = value.primaryBranchId ? String(value.primaryBranchId) : undefined
  const expectedUserVersion = value.expectedUserVersion === undefined
    ? undefined
    : Number(value.expectedUserVersion)
  if (primaryIndustryTagId && !isUuid(primaryIndustryTagId)) {
    throw new Error('VALIDATION_FAILED')
  }
  if ((primaryBranchId && !isUuid(primaryBranchId))
    || ((primaryBranchId || expectedUserVersion !== undefined)
      && (!primaryBranchId || !Number.isInteger(expectedUserVersion) || expectedUserVersion < 1))) {
    throw new Error('VALIDATION_FAILED')
  }
  return {
    expectedVersion,
    avatarAssetId,
    expectedUserVersion,
    primaryBranchId,
    nickname,
    identityStatus,
    headline,
    introduction,
    companies,
    organizations: organizationList,
    visibility: visibility(value.visibility),
    primaryIndustryTagId,
    abilityTagIds,
  }
}

function organizations(value) {
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('VALIDATION_FAILED')
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('VALIDATION_FAILED')
    }
    return {
      name: boundedText(item.name, 1, 120),
      role: boundedText(item.role, 0, 80) || undefined,
    }
  })
}

function uniqueIds(value, limit) {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error('VALIDATION_FAILED')
  }
  const result = [...new Set(value.map(item => String(item)))]
  if (result.some(item => !isUuid(item))) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function boundedText(value, minimum, maximum) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length < minimum || result.length > maximum) {
    throw new Error('VALIDATION_FAILED')
  }
  return result
}

function visibility(value) {
  const input = parseJson(value)
  return {
    nickname: input.nickname !== false,
    avatar: input.avatar !== false,
    identityStatus: input.identityStatus !== false,
    headline: input.headline !== false,
    introduction: input.introduction !== false,
    companies: input.companies !== false,
    organizations: input.organizations !== false,
    industry: input.industry !== false,
    abilities: input.abilities !== false,
    primaryBranch: input.primaryBranch !== false,
  }
}

function jsonArray(value) {
  const result = parseJson(value)
  return Array.isArray(result) ? result : []
}

function parseJson(value) {
  if (value && typeof value === 'object') {
    return value
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    }
    catch {
      return {}
    }
  }
  return {}
}

function branchDtos(rows) {
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    cityName: row.city_name,
    status: row.status,
  }))
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

module.exports = {
  ACCOUNT_CLOSURE_CONFIRMATION_PHRASE,
  createIdentityService,
  defaultAgreements,
  membershipProjection,
  normalizeAccountClosureInput,
  normalizeProfileInput,
  profileDto,
  publicProfileDto,
  snapshotDto,
}
