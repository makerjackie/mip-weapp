'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { createAdminAccess } = require('../domain/access')
const { CAPABILITIES } = require('../domain/capabilities')
const { createAdminMessaging } = require('../domain/messaging')
const { AdminError } = require('../domain/validation')
const { createProfileRef, readProfileRef } = require('../lib/profile-ref')

const APP_ID = 'wx-messaging-app'
const OTHER_APP_ID = 'wx-other-app'
const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const RECIPIENT_ID = '20000000-0000-4000-8000-000000000002'
const ANNOUNCEMENT_ID = '30000000-0000-4000-8000-000000000003'
const CAMPAIGN_ID = '40000000-0000-4000-8000-000000000004'
const EVENT_ID = '50000000-0000-4000-8000-000000000005'
const BRANCH_A = '60000000-0000-4000-8000-000000000006'
const BRANCH_B = '70000000-0000-4000-8000-000000000007'
const PROFILE_REF_SECRET = 'messaging-profile-reference-secret-2026'
const caller = { appId: APP_ID, identityKey: 'wechat-identity' }

function repository(overrides = {}) {
  const repo = {
    user: {
      id: ACTOR_ID,
      status: 'ACTIVE',
      agreementsAccepted: true,
      phoneBound: true,
      profileComplete: true,
    },
    roleBindings: [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }],
    announcementScope: { scopeType: 'BRANCH', scopeId: BRANCH_A, status: 'DRAFT' },
    campaignScope: { scopeType: 'BRANCH', scopeId: BRANCH_A, status: 'DRAFT' },
    calls: [],
    resolveReads: 0,
    announcementReads: 0,
    campaignReads: 0,
    recipientReads: 0,
    async resolveUser() {
      repo.resolveReads += 1
      return { ...repo.user }
    },
    async listRoleBindings() {
      return repo.roleBindings
    },
    async listAnnouncementScopes(appId, visibility) {
      repo.calls.push({ type: 'announcementScopes', appId, visibility })
      return { platform: visibility.platform, branches: [] }
    },
    async listAnnouncements(appId, visibility, filters, pageLimit) {
      repo.calls.push({ type: 'announcementList', appId, visibility, filters, pageLimit })
      return []
    },
    async getAnnouncementScope(_appId, announcementId) {
      repo.calls.push({ type: 'announcementScope', announcementId })
      return announcementId === 'missing-announcement' ? null : repo.announcementScope
    },
    async getAnnouncement(_appId, announcementId) {
      repo.announcementReads += 1
      return announcementRow({ id: announcementId })
    },
    async saveAnnouncement(input) {
      repo.calls.push({ type: 'announcementSave', input })
      return announcementRow({
        id: input.announcementId || ANNOUNCEMENT_ID,
        scopeType: input.draft.scopeType,
        branchId: input.draft.branchId,
        body: input.draft.body,
        version: input.announcementId ? input.expectedVersion + 1 : 1,
      })
    },
    async publishAnnouncement(input) {
      repo.calls.push({ type: 'announcementPublish', input })
      return announcementRow({ status: 'PUBLISHED', version: input.expectedVersion + 1 })
    },
    async withdrawAnnouncement(input) {
      repo.calls.push({ type: 'announcementWithdraw', input })
      return announcementRow({ status: 'WITHDRAWN', version: input.expectedVersion + 1 })
    },
    async setAnnouncementPinned(input) {
      repo.calls.push({ type: 'announcementPin', input })
      return announcementRow({ isPinned: input.pinned, version: input.expectedVersion + 1 })
    },
    async listScopes(appId, visibility) {
      repo.calls.push({ type: 'campaignScopes', appId, visibility })
      return { platform: visibility.platform, branches: [] }
    },
    async listCampaigns(appId, visibility, filters, pageLimit) {
      repo.calls.push({ type: 'campaignList', appId, visibility, filters, pageLimit })
      return [campaignRow()]
    },
    async getCampaignScope(_appId, campaignId) {
      repo.calls.push({ type: 'campaignScope', campaignId })
      return campaignId === 'missing-campaign' ? null : repo.campaignScope
    },
    async getCampaign(_appId, campaignId) {
      repo.campaignReads += 1
      return campaignRow({ id: campaignId })
    },
    async searchRecipients(appId, scope, query, pageLimit) {
      repo.recipientReads += 1
      repo.calls.push({ type: 'recipientSearch', appId, scope, query, pageLimit })
      return [{
        id: RECIPIENT_ID,
        nickname: '测试用户',
        headline: '产品负责人',
        branch_name: '广州分会',
        phone_ciphertext: Buffer.from('private'),
        openid: 'private-openid',
      }]
    },
    async saveCampaign(input) {
      repo.calls.push({ type: 'campaignSave', input })
      return campaignRow({
        id: input.campaignId || CAMPAIGN_ID,
        scopeType: input.draft.scopeType,
        branchId: input.draft.branchId,
        audienceType: input.draft.audienceType,
        audienceUserIds: input.draft.audienceUserIds,
        version: input.campaignId ? input.expectedVersion + 1 : 1,
      })
    },
    async snapshotCampaign(input) {
      repo.calls.push({ type: 'campaignSnapshot', input })
      return campaignRow({ status: 'READY', version: input.expectedVersion + 1 })
    },
    async publishCampaign(input) {
      repo.calls.push({ type: 'campaignPublish', input })
      return {
        campaignId: input.campaignId,
        status: 'PUBLISHED',
        recipientCount: 1,
        queuedCount: 1,
        wechatDelivery: 'NOT_CONFIGURED',
        version: input.expectedVersion + 1,
        idempotent: false,
      }
    },
    async withdrawCampaign(input) {
      repo.calls.push({ type: 'campaignWithdraw', input })
      return campaignRow({ status: 'WITHDRAWN', version: input.expectedVersion + 1 })
    },
    ...overrides,
  }
  return repo
}

function messaging(repo, ports = {}) {
  return createAdminMessaging({
    access: createAdminAccess({ repository: repo }),
    profileRefSecret: PROFILE_REF_SECRET,
    repository: repo,
    ...ports,
  })
}

function announcementDraft(overrides = {}) {
  return {
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    title: '活动安排调整',
    summary: '活动时间已调整',
    body: '请在活动页面查看最新安排。',
    targetType: 'EVENT',
    targetId: EVENT_ID,
    visibleFrom: '2030-08-25T08:00:00.000Z',
    visibleUntil: '2030-09-25T08:00:00.000Z',
    ...overrides,
  }
}

function announcementRow(overrides = {}) {
  return {
    id: ANNOUNCEMENT_ID,
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    branchName: '广州分会',
    title: '活动安排调整',
    summary: '活动时间已调整',
    body: '请在活动页面查看最新安排。',
    targetType: 'EVENT',
    targetId: EVENT_ID,
    status: 'DRAFT',
    contentSafetyStatus: 'PASSED',
    isPinned: false,
    visibleFrom: '2030-08-25T08:00:00.000Z',
    visibleUntil: '2030-09-25T08:00:00.000Z',
    publishedAt: null,
    withdrawnAt: null,
    version: 4,
    updatedAt: '2030-08-24T08:00:00.000Z',
    ...overrides,
  }
}

function campaignDraft(overrides = {}) {
  return {
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    audienceType: 'ALL',
    name: '九月活动提醒',
    title: '活动安排已更新',
    body: '请在活动页面查看最新安排。',
    ...overrides,
  }
}

function campaignRow(overrides = {}) {
  return {
    id: CAMPAIGN_ID,
    scopeType: 'BRANCH',
    branchId: BRANCH_A,
    branchName: '广州分会',
    audienceType: 'EXPLICIT',
    audienceUserIds: [RECIPIENT_ID],
    name: '九月活动提醒',
    title: '活动安排已更新',
    body: '请在活动页面查看最新安排。',
    status: 'DRAFT',
    contentSafetyStatus: 'PASSED',
    recipientCount: 0,
    publishIdempotencyKey: 'private-publish-key',
    publishRequestHash: 'private-request-hash',
    version: 4,
    updatedAt: '2030-08-24T08:00:00.000Z',
    ...overrides,
  }
}

describe('admin messaging deep module', () => {
  it('exposes only announcement and message-campaign administration', () => {
    const api = createAdminMessaging({ repository: {}, access: {} })
    assert.deepEqual(Object.keys(api).sort(), [
      'getAnnouncement',
      'getMessageCampaign',
      'listAnnouncementScopes',
      'listAnnouncements',
      'listMessageCampaignScopes',
      'listMessageCampaigns',
      'publishAnnouncement',
      'publishMessageCampaign',
      'saveAnnouncement',
      'saveMessageCampaign',
      'searchMessageRecipients',
      'setAnnouncementPinned',
      'snapshotMessageCampaign',
      'withdrawAnnouncement',
      'withdrawMessageCampaign',
    ])
  })

  it('reloads current user, agreement and role facts before every request', async () => {
    const repo = repository()
    const service = messaging(repo)

    await service.listAnnouncements({
      ...caller,
      roles: [{ roleKey: 'PLATFORM_OWNER', scopeType: 'PLATFORM', scopeId: null }],
    })
    repo.roleBindings = [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => service.listAnnouncements(caller),
      error => error?.code === 'FORBIDDEN',
    )
    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    repo.user.agreementsAccepted = false
    await assert.rejects(
      () => service.listAnnouncements(caller),
      error => error?.message === 'AGREEMENT_REQUIRED',
    )

    assert.equal(repo.resolveReads, 3)
    assert.equal(repo.calls.filter(call => call.type === 'announcementList').length, 1)
  })

  it('enforces platform, branch, and event-role scope without reading unauthorized resources', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = messaging(repo)

    await service.listAnnouncements(caller, { status: 'draft' })
    await service.listMessageCampaigns(caller, { status: 'draft' })
    const announcementList = repo.calls.find(call => call.type === 'announcementList')
    const campaignList = repo.calls.find(call => call.type === 'campaignList')
    assert.deepEqual(announcementList.visibility, {
      platform: false, branchIds: [BRANCH_A], eventIds: [],
    })
    assert.deepEqual(campaignList.visibility, announcementList.visibility)

    repo.announcementScope = { scopeType: 'BRANCH', scopeId: BRANCH_B, status: 'DRAFT' }
    await assert.rejects(
      () => service.getAnnouncement(caller, { announcementId: ANNOUNCEMENT_ID }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.getAnnouncement(caller, { announcementId: 'missing-announcement' }),
      error => error?.code === 'NOT_FOUND',
    )
    repo.campaignScope = { scopeType: 'BRANCH', scopeId: BRANCH_B, status: 'DRAFT' }
    await assert.rejects(
      () => service.getMessageCampaign(caller, { campaignId: CAMPAIGN_ID }),
      error => error?.code === 'FORBIDDEN',
    )
    await assert.rejects(
      () => service.getMessageCampaign(caller, { campaignId: 'missing-campaign' }),
      error => error?.code === 'NOT_FOUND',
    )
    assert.equal(repo.announcementReads, 0)
    assert.equal(repo.campaignReads, 0)

    repo.roleBindings = [{ roleKey: 'EVENT_MANAGER', scopeType: 'EVENT', scopeId: EVENT_ID }]
    await assert.rejects(
      () => service.searchMessageRecipients(caller, { branchId: BRANCH_A }),
      error => error?.code === 'FORBIDDEN',
    )
    assert.equal(repo.recipientReads, 0)

    repo.roleBindings = [{ roleKey: 'PLATFORM_OPERATIONS', scopeType: 'PLATFORM', scopeId: null }]
    await service.searchMessageRecipients(caller)
    assert.equal(repo.recipientReads, 1)
  })

  it('keeps announcement scheduling, scope changes, safety, versions and audit evidence intact', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const checked = []
    const service = messaging(repo, {
      contentSafety: async (draft, checkedCaller) => {
        checked.push({ draft, caller: checkedCaller })
        return 'PASSED'
      },
    })
    const result = await service.saveAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID,
      expectedVersion: 4,
      ...announcementDraft(),
    })
    const saved = repo.calls.find(call => call.type === 'announcementSave').input

    assert.equal(result.version, 5)
    assert.equal(saved.expectedVersion, 4)
    assert.deepEqual(saved.authorizedExistingScope, repo.announcementScope)
    assert.deepEqual(saved.authorization, {
      capability: CAPABILITIES.ANNOUNCEMENTS_MANAGE,
      effectiveGrant: { roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A },
    })
    assert.equal(saved.contentSafetyStatus, 'PASSED')
    assert.equal(checked[0].draft.targetType, 'EVENT')
    assert.equal(checked[0].draft.visibleFrom.toISOString(), '2030-08-25T08:00:00.000Z')
    assert.equal(saved.audit(ANNOUNCEMENT_ID, 'admin.announcements.update', { expectedVersion: 4 }).resourceType, 'ANNOUNCEMENT')

    const savesBeforeInvalid = repo.calls.filter(call => call.type === 'announcementSave').length
    await assert.rejects(() => service.saveAnnouncement(caller, {
      ...announcementDraft({ visibleUntil: '2030-08-25T07:59:59.999Z' }),
    }), error => error?.code === 'VALIDATION_FAILED')
    assert.equal(repo.calls.filter(call => call.type === 'announcementSave').length, savesBeforeInvalid)
    assert.equal(checked.length, 1)

    await assert.rejects(() => service.saveAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID,
      expectedVersion: 4,
      ...announcementDraft({ branchId: BRANCH_B }),
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(repo.calls.filter(call => call.type === 'announcementSave').length, savesBeforeInvalid)
    assert.equal(checked.length, 1)

    repo.saveAnnouncement = async () => { throw new AdminError('CONFLICT', '记录已变更') }
    await assert.rejects(() => service.saveAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID,
      expectedVersion: 4,
      ...announcementDraft(),
    }), error => error?.code === 'CONFLICT')
  })

  it('preserves announcement publish, withdraw, and pin state-machine inputs', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = messaging(repo, {
      contentSafety: async () => { throw new Error('unexpected content safety call') },
    })

    await service.publishAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID, expectedVersion: 4,
    })
    await service.withdrawAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID, expectedVersion: 5, reason: '  内容已失效  ',
    })
    await service.setAnnouncementPinned(caller, {
      announcementId: ANNOUNCEMENT_ID, expectedVersion: 6, pinned: true,
    })

    const published = repo.calls.find(call => call.type === 'announcementPublish').input
    const withdrawn = repo.calls.find(call => call.type === 'announcementWithdraw').input
    const pinned = repo.calls.find(call => call.type === 'announcementPin').input
    assert.equal(published.expectedVersion, 4)
    assert.deepEqual(published.authorizedScope, repo.announcementScope)
    assert.equal(published.audit(ANNOUNCEMENT_ID, 'admin.announcements.publish', {}).effectiveRole, 'BRANCH_ADMIN')
    assert.equal(withdrawn.reason, '内容已失效')
    assert.equal(withdrawn.expectedVersion, 5)
    assert.equal(pinned.pinned, true)
    assert.equal(pinned.expectedVersion, 6)

    await assert.rejects(() => service.setAnnouncementPinned(caller, {
      announcementId: ANNOUNCEMENT_ID, expectedVersion: 6, pinned: 'true',
    }), error => error?.code === 'VALIDATION_FAILED')
    assert.equal(repo.calls.filter(call => call.type === 'announcementPin').length, 1)

    repo.publishAnnouncement = async () => { throw new AdminError('INVALID_STATE', '公告状态无效') }
    await assert.rejects(() => service.publishAnnouncement(caller, {
      announcementId: ANNOUNCEMENT_ID, expectedVersion: 4,
    }), error => error?.code === 'INVALID_STATE')
  })

  it('returns opaque campaign recipients and the minimal recipient-search projection', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const service = messaging(repo)
    const page = await service.listMessageCampaigns(caller, {
      status: 'draft', query: '  活动  ', limit: 200,
    })
    const search = await service.searchMessageRecipients(caller, {
      branchId: BRANCH_A, query: '  测试  ', limit: 200,
    })

    assert.equal(page.items.length, 1)
    assert.equal(Object.hasOwn(page.items[0], 'audienceUserIds'), false)
    assert.equal(Object.hasOwn(page.items[0], 'publishIdempotencyKey'), false)
    assert.equal(Object.hasOwn(page.items[0], 'publishRequestHash'), false)
    assert.equal(readProfileRef(page.items[0].recipientRefs[0], APP_ID, PROFILE_REF_SECRET), RECIPIENT_ID)
    const listed = repo.calls.find(call => call.type === 'campaignList')
    assert.deepEqual(listed.filters, { status: 'DRAFT', query: '活动' })
    assert.equal(listed.pageLimit, 50)

    assert.deepEqual(Object.keys(search.items[0]).sort(), [
      'branchName', 'headline', 'nickname', 'profileRef',
    ])
    assert.deepEqual(search.items[0], {
      profileRef: createProfileRef({ appId: APP_ID, userId: RECIPIENT_ID }, PROFILE_REF_SECRET),
      nickname: '测试用户',
      headline: '产品负责人',
      branchName: '广州分会',
    })
    const searched = repo.calls.find(call => call.type === 'recipientSearch')
    assert.deepEqual(searched.scope, { scopeType: 'BRANCH', scopeId: BRANCH_A })
    assert.equal(searched.query, '测试')
    assert.equal(searched.pageLimit, 50)
  })

  it('decodes explicit recipients only after scope authorization and preserves save conflicts', async () => {
    const repo = repository()
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    const checked = []
    const service = messaging(repo, {
      contentSafety: async (draft) => {
        checked.push(draft)
        return 'PASSED'
      },
    })
    const recipientRef = createProfileRef({ appId: APP_ID, userId: RECIPIENT_ID }, PROFILE_REF_SECRET)
    const result = await service.saveMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID,
      expectedVersion: 4,
      ...campaignDraft({ audienceType: 'EXPLICIT', recipientRefs: [recipientRef] }),
    })
    const saved = repo.calls.find(call => call.type === 'campaignSave').input

    assert.equal(result.version, 5)
    assert.equal(Object.hasOwn(result, 'audienceUserIds'), false)
    assert.equal(readProfileRef(result.recipientRefs[0], APP_ID, PROFILE_REF_SECRET), RECIPIENT_ID)
    assert.deepEqual(saved.draft.audienceUserIds, [RECIPIENT_ID])
    assert.equal(Object.hasOwn(saved.draft, 'recipientRefs'), false)
    assert.equal(saved.expectedVersion, 4)
    assert.deepEqual(saved.authorizedExistingScope, repo.campaignScope)
    assert.equal(saved.authorization.capability, CAPABILITIES.MESSAGES_MANAGE)
    assert.equal(saved.audit(CAMPAIGN_ID, 'admin.message_campaigns.update', {}).resourceType, 'MESSAGE_CAMPAIGN')
    assert.deepEqual(checked[0].audienceUserIds, [RECIPIENT_ID])

    const savesBeforeInvalid = repo.calls.filter(call => call.type === 'campaignSave').length
    const otherAppRef = createProfileRef(
      { appId: OTHER_APP_ID, userId: RECIPIENT_ID },
      PROFILE_REF_SECRET,
    )
    await assert.rejects(() => service.saveMessageCampaign(caller, {
      ...campaignDraft({ audienceType: 'EXPLICIT', recipientRefs: [otherAppRef] }),
    }), error => error?.code === 'MESSAGE_RECIPIENT_INVALID')
    assert.equal(repo.calls.filter(call => call.type === 'campaignSave').length, savesBeforeInvalid)
    assert.equal(checked.length, 1)

    await assert.rejects(() => service.saveMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID,
      expectedVersion: 4,
      ...campaignDraft({
        branchId: BRANCH_B,
        audienceType: 'EXPLICIT',
        recipientRefs: [recipientRef],
      }),
    }), error => error?.code === 'FORBIDDEN')
    assert.equal(repo.calls.filter(call => call.type === 'campaignSave').length, savesBeforeInvalid)
    assert.equal(checked.length, 1)

    repo.saveCampaign = async () => { throw new AdminError('CONFLICT', '记录已变更') }
    await assert.rejects(() => service.saveMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID,
      expectedVersion: 4,
      ...campaignDraft(),
    }), error => error?.code === 'CONFLICT')
  })

  it('keeps snapshot, idempotent publish, and withdraw inside the repository commit boundary', async () => {
    let completePublish
    const repo = repository({
      async publishCampaign(input) {
        repo.calls.push({ type: 'campaignPublish', input })
        return new Promise((resolve) => { completePublish = resolve })
      },
    })
    repo.roleBindings = [{ roleKey: 'BRANCH_ADMIN', scopeType: 'BRANCH', scopeId: BRANCH_A }]
    let externalCalls = 0
    const service = messaging(repo, {
      contentSafety: async () => {
        externalCalls += 1
        return 'PASSED'
      },
    })

    const snapshot = await service.snapshotMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID, expectedVersion: 4,
    })
    assert.equal(snapshot.status, 'READY')
    assert.equal(Object.hasOwn(snapshot, 'audienceUserIds'), false)

    let publishSettled = false
    const pendingPublish = service.publishMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID,
      expectedVersion: 5,
      idempotencyKey: '  campaign-publish-2030-001  ',
    }).then((value) => {
      publishSettled = true
      return value
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(publishSettled, false)
    assert.equal(externalCalls, 0)
    completePublish({
      campaignId: CAMPAIGN_ID,
      status: 'PUBLISHED',
      recipientCount: 1,
      queuedCount: 1,
      wechatDelivery: 'NOT_CONFIGURED',
      version: 6,
      idempotent: false,
    })
    const published = await pendingPublish
    assert.equal(published.status, 'PUBLISHED')
    assert.equal(published.idempotent, false)

    const withdrawn = await service.withdrawMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID, expectedVersion: 6, reason: '  内容已过期  ',
    })
    assert.equal(withdrawn.status, 'WITHDRAWN')
    assert.equal(Object.hasOwn(withdrawn, 'audienceUserIds'), false)
    assert.equal(externalCalls, 0)

    const snapshotInput = repo.calls.find(call => call.type === 'campaignSnapshot').input
    const publishInput = repo.calls.find(call => call.type === 'campaignPublish').input
    const withdrawInput = repo.calls.find(call => call.type === 'campaignWithdraw').input
    assert.equal(snapshotInput.expectedVersion, 4)
    assert.deepEqual(snapshotInput.authorizedScope, repo.campaignScope)
    assert.equal(snapshotInput.audit(CAMPAIGN_ID, 'admin.message_campaigns.snapshot', {}).effectiveRole, 'BRANCH_ADMIN')
    assert.equal(publishInput.expectedVersion, 5)
    assert.equal(publishInput.idempotencyKey, 'campaign-publish-2030-001')
    assert.equal(withdrawInput.expectedVersion, 6)
    assert.equal(withdrawInput.reason, '内容已过期')

    repo.snapshotCampaign = async () => { throw new AdminError('MESSAGE_CAMPAIGN_IMMUTABLE', '消息活动不可修改') }
    await assert.rejects(() => service.snapshotMessageCampaign(caller, {
      campaignId: CAMPAIGN_ID, expectedVersion: 4,
    }), error => error?.code === 'MESSAGE_CAMPAIGN_IMMUTABLE')
  })
})
