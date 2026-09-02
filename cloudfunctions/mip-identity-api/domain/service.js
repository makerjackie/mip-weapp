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
    documentPath: '/packages/member/privacy-policy/index',
  },
]

function createIdentityService(options) {
  const repository = options.repository
  const agreements = options.agreements || defaultAgreements
  const phoneResolver = options.phoneResolver
  const protectPhone = options.protectPhone
  const revealPhone = options.revealPhone
  const protectContact = options.protectContact
  const revealContact = options.revealContact
  const profileRefReader = options.profileRefReader
  const profileRefWriter = options.profileRefWriter
  const profileCardCodeWriter = options.profileCardCodeWriter
  const profileCardSceneReader = options.profileCardSceneReader
  const entitlementReader = options.entitlementReader || {
    load: (appId, userId) => repository.loadEntitlement(appId, userId),
  }

  async function getAccessSnapshot(caller) {
    const user = await repository.ensureUser(caller)
    const facts = await repository.loadFacts(caller.appId, user.id)
    const membership = await membershipProjection(entitlementReader, caller.appId, user.id)
    const profileRef = typeof profileRefWriter === 'function'
      ? profileRefWriter({ appId: caller.appId, userId: user.id })
      : undefined
    return snapshotDto(facts, agreements, membership, profileRef)
  }

  async function acceptAgreements(caller, input) {
    assertCurrentAgreementAcceptance(input, agreements)
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
    await repository.bindPhone(caller, user.id, protectPhone(phoneInfo, {
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
    return profileDto(facts, {
      includePrivateContact: true,
      appId: caller.appId,
      userId: user.id,
      revealPhone,
      revealContact,
    })
  }

  async function getMyProfileCardCode(caller) {
    if (typeof profileCardCodeWriter !== 'function') {
      throw new Error('PROFILE_CARD_CODE_UNAVAILABLE')
    }
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    return profileCardCodeWriter({ appId: caller.appId, userId: user.id })
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

  async function resolveProfileCardScene(caller, value) {
    const scene = typeof value?.scene === 'string' ? value.scene.trim() : ''
    if (!scene || typeof profileCardSceneReader !== 'function' || typeof profileRefWriter !== 'function') {
      throw new Error('PUBLIC_PROFILE_NOT_FOUND')
    }
    const userId = profileCardSceneReader(scene, caller.appId)
    const viewer = await repository.findUserByIdentity(caller)
    const facts = await repository.loadPublicProfile(caller.appId, userId, viewer?.id || null)
    if (!facts) {
      throw new Error('PUBLIC_PROFILE_NOT_FOUND')
    }
    return { profileRef: profileRefWriter({ appId: caller.appId, userId }) }
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

  async function updateCard(caller, value) {
    const input = normalizeCardInput(value?.input)
    const user = await repository.ensureUser(caller)
    assertActiveUser(user)
    if (typeof protectContact !== 'function') throw new Error('CONTACT_SERVICE_UNAVAILABLE')
    await repository.updateCard(caller.appId, user.id, input, value => protectContact(value, {
      appId: caller.appId,
      userId: user.id,
    }))
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
      popular: Boolean(row.popular),
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
    getMyProfileCardCode,
    getProfile,
    getPublicProfile,
    listBranches,
    listProfileTags,
    resolveProfileCardScene,
    setPrimaryBranch,
    updateProfile,
    updateCard,
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

function assertCurrentAgreementAcceptance(input, agreements) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== 1
    || !Object.hasOwn(input, 'agreements')
    || !Array.isArray(input.agreements)
    || input.agreements.length !== agreements.length) {
    throw new Error('AGREEMENT_VERSION_CHANGED')
  }

  const expected = new Set(agreements.map(
    agreement => `${agreement.key}\u0000${agreement.version}`,
  ))
  const submitted = new Set()
  for (const agreement of input.agreements) {
    if (!agreement || typeof agreement !== 'object' || Array.isArray(agreement)
      || Object.keys(agreement).length !== 2
      || !Object.hasOwn(agreement, 'key')
      || !Object.hasOwn(agreement, 'version')
      || typeof agreement.key !== 'string'
      || typeof agreement.version !== 'string') {
      throw new Error('AGREEMENT_VERSION_CHANGED')
    }
    const signature = `${agreement.key}\u0000${agreement.version}`
    if (!expected.has(signature) || submitted.has(signature)) {
      throw new Error('AGREEMENT_VERSION_CHANGED')
    }
    submitted.add(signature)
  }
  if (submitted.size !== expected.size) {
    throw new Error('AGREEMENT_VERSION_CHANGED')
  }
}

function snapshotDto(facts, agreements, membership, profileRef) {
  const accepted = new Set((facts.acceptances || []).map(
    item => `${item.agreement_key}:${item.agreement_version}`,
  ))
  return {
    authenticated: true,
    userId: facts.user.id,
    ...(profileRef ? { profileRef } : {}),
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

function profileDto(facts, options = {}) {
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
    realName: profile?.real_name || '',
    gender: profile?.gender || 'UNKNOWN',
    careerIdentityKey: profile?.career_identity_key || '',
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
    ...(options.includePrivateContact ? {
      privateContact: privateContactDto(facts, options),
    } : {}),
  }
}

function privateContactDto(facts, options) {
  const privateProfile = facts.privateProfile || {}
  const context = { appId: options.appId, userId: options.userId }
  let phoneMasked
  let phoneNumber
  if (typeof options.revealPhone === 'function' && privateProfile.phone_ciphertext) {
    try {
      const phone = options.revealPhone(privateProfile.phone_ciphertext, context)
      const digits = String(phone).split(':').pop() || ''
      phoneNumber = digits || undefined
      phoneMasked = digits.length > 7 ? `${digits.slice(0, 3)}****${digits.slice(-4)}` : '已绑定手机号'
    } catch {}
  }
  const reveal = (cipher) => {
    if (!cipher || typeof options.revealContact !== 'function') return undefined
    try { return options.revealContact(cipher, context) || undefined } catch { return undefined }
  }
  return {
    phoneBound: Boolean(privateProfile.phone_verified_at),
    ...(phoneNumber ? { phone: phoneNumber } : {}),
    ...(phoneMasked ? { phoneMasked } : {}),
    ...(reveal(privateProfile.wechat_ciphertext) ? { wechat: reveal(privateProfile.wechat_ciphertext) } : {}),
    ...(reveal(privateProfile.email_ciphertext) ? { email: reveal(privateProfile.email_ciphertext) } : {}),
    ...(reveal(privateProfile.address_ciphertext) ? { address: reveal(privateProfile.address_ciphertext) } : {}),
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
    ...(allowed.realName && profile.real_name ? { realName: String(profile.real_name).trim() } : {}),
    ...(allowed.gender && profile.gender ? { gender: String(profile.gender) } : {}),
    ...(allowed.careerIdentity && profile.career_identity_key ? { careerIdentityKey: String(profile.career_identity_key) } : {}),
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
  const introduction = boundedText(value.introduction, 0, 300)
  const realName = boundedText(value.realName, 0, 64)
  const gender = ['UNKNOWN', 'MALE', 'FEMALE'].includes(value.gender) ? value.gender : 'UNKNOWN'
  const careerIdentityKey = boundedText(value.careerIdentityKey, 0, 32)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new Error('VALIDATION_FAILED')
  }
  if (avatarAssetId !== undefined && !isUuid(avatarAssetId)) {
    throw new Error('VALIDATION_FAILED')
  }
  if (careerIdentityKey && !/^[A-Z][A-Z0-9_]{0,31}$/.test(careerIdentityKey)) {
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
    realName,
    gender,
    careerIdentityKey,
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
  if (!Array.isArray(value) || value.length > 12) {
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
  const result = {
    nickname: input.nickname !== false,
    realName: input.realName === true,
    gender: input.gender === true,
    careerIdentity: input.careerIdentity === true,
    avatar: input.avatar !== false,
    identityStatus: input.identityStatus !== false,
    headline: input.headline !== false,
    introduction: input.introduction !== false,
    companies: input.companies !== false,
    organizations: input.organizations !== false,
    industry: input.industry !== false,
    abilities: input.abilities !== false,
    primaryBranch: input.primaryBranch !== false,
    influence: input.influence === true,
  }
  if (input.cardContacts && typeof input.cardContacts === 'object') {
    result.cardContacts = {
      phone: input.cardContacts.phone === true,
      wechat: input.cardContacts.wechat === true,
      email: input.cardContacts.email === true,
      address: input.cardContacts.address === true,
    }
  }
  return result
}

function normalizeCardInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED')
  const expectedVersion = Number(value.expectedVersion)
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('VALIDATION_FAILED')
  return {
    expectedVersion,
    realName: boundedText(value.realName, 0, 64),
    companies: organizations(value.companies),
    organizations: organizations(value.organizations),
    wechat: boundedText(value.wechat, 0, 120),
    email: boundedText(value.email, 0, 160),
    address: boundedText(value.address, 0, 240),
    visibility: {
      cardContacts: {
        phone: value.visibility?.cardContacts?.phone === true,
        wechat: value.visibility?.cardContacts?.wechat === true,
        email: value.visibility?.cardContacts?.email === true,
        address: value.visibility?.cardContacts?.address === true,
      },
    },
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
  assertCurrentAgreementAcceptance,
  createIdentityService,
  defaultAgreements,
  membershipProjection,
  normalizeAccountClosureInput,
  normalizeProfileInput,
  profileDto,
  publicProfileDto,
  snapshotDto,
}
