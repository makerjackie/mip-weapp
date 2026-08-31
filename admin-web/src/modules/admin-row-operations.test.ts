import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  announcementRowActions,
  branchRowActions,
  communityReportRowActions,
  eventAlbumRowActions,
  eventCatalogRowActions,
  eventPolicyRowActions,
  eventRegistrationRowActions,
  messageScheduleCancelAction,
  messageTemplateRowActions,
  parseAdminOperationLaunchContext,
  rolePolicyRowActions,
} from './admin-row-operations.ts'

describe('admin row operations', () => {
  it('exposes only the registration action legal for the current server state', () => {
    const pending = eventRegistrationRowActions('event-1', {
      id: 'registration-1', version: 2, status: 'PENDING_REVIEW',
    })
    const registered = eventRegistrationRowActions('event-1', {
      id: 'registration-1', version: 3, status: 'REGISTERED',
    })
    const attended = eventRegistrationRowActions('event-1', {
      id: 'registration-1', version: 4, status: 'ATTENDED',
    })

    assert.deepEqual(pending, [{
      action: 'mip.admin.events.registrations.review', label: '审核', targetId: 'event-1',
      values: { eventId: 'event-1', registrationId: 'registration-1', expectedVersion: 2 },
    }])
    assert.equal(registered[0]?.action, 'mip.admin.events.checkIn')
    assert.deepEqual(registered[0]?.values, {
      eventId: 'event-1', registrationId: 'registration-1', expectedVersion: 3,
    })
    assert.equal(attended[0]?.action, 'mip.admin.events.undoCheckIn')
    assert.deepEqual(eventRegistrationRowActions('event-1', {
      id: 'registration-1', version: 5, status: 'CANCELLED',
    }), [])
  })

  it('requires a pending, versioned album photo before exposing review', () => {
    assert.deepEqual(eventAlbumRowActions('event-1', {
      id: 'photo-1', version: 2, status: 'PENDING',
    }), [{
      action: 'mip.admin.events.album.review', label: '审核', targetId: 'event-1',
      values: { eventId: 'event-1', photoId: 'photo-1', expectedVersion: 2 },
    }])
    assert.deepEqual(eventAlbumRowActions('event-1', {
      id: 'photo-1', version: 2, status: 'PUBLISHED',
    }), [])
  })

  it('carries policy and branch list facts into their reviewed mutation forms', () => {
    assert.deepEqual(rolePolicyRowActions({
      roleKey: 'BRANCH_ADMIN', version: 0,
      capabilities: ['events.read'],
      allowedCapabilities: ['events.read', 'events.write'],
    }), [{
      action: 'mip.admin.rolePolicies.update', label: '更新策略',
      values: { roleKey: 'BRANCH_ADMIN', capabilities: ['events.read'], reset: false },
      expectedVersion: 0,
      allowedCapabilities: ['events.read', 'events.write'],
    }])

    const actions = branchRowActions({
      id: 'branch-1', version: 3, status: 'ACTIVE',
      name: '福田分会', cityName: '深圳', summary: '城市分会',
    })
    assert.deepEqual(actions.map(item => item.action), [
      'mip.admin.branches.update', 'mip.admin.branches.changeStatus',
    ])
    assert.equal(actions[1]?.label, '停用')
    assert.deepEqual(actions[1]?.values, { status: 'INACTIVE' })
    assert.equal(actions[1]?.expectedVersion, 3)
  })

  it('exposes cancellation only for a cancellable active schedule', () => {
    const campaign = { id: 'campaign-1', version: 4, status: 'READY' }
    const dispatch = {
      version: 2, status: 'SCHEDULED', lastOutcome: 'NOT_ATTEMPTED', retryDisposition: 'RETRYABLE',
    }
    assert.deepEqual(messageScheduleCancelAction(campaign, dispatch), {
      action: 'mip.admin.messageCampaigns.cancelSchedule', label: '取消发送计划', targetId: 'campaign-1',
      values: { campaignId: 'campaign-1', expectedVersion: 4, expectedDispatchVersion: 2, reason: '' },
    })
    assert.equal(messageScheduleCancelAction(campaign, { ...dispatch, status: 'PROCESSING' }), null)
    assert.equal(messageScheduleCancelAction(campaign, { ...dispatch, retryDisposition: 'MANUAL_REVIEW' }), null)
    assert.equal(messageScheduleCancelAction({ ...campaign, status: 'PUBLISHED' }, dispatch), null)
  })

  it('uses versioned announcement, template, and report facts for legal transitions', () => {
    assert.deepEqual(announcementRowActions({
      id: 'announcement-1', version: 2, status: 'DRAFT', isPinned: false,
    }), [{
      action: 'mip.admin.announcements.publish', label: '发布', targetId: 'announcement-1',
      values: { announcementId: 'announcement-1', expectedVersion: 2 },
    }])
    assert.deepEqual(announcementRowActions({
      id: 'announcement-1', version: 3, status: 'PUBLISHED', isPinned: true,
    }).map(item => [item.action, item.label]), [
      ['mip.admin.announcements.withdraw', '撤回'],
      ['mip.admin.announcements.pin', '取消置顶'],
    ])

    assert.deepEqual(messageTemplateRowActions({
      id: 'template-1', version: 4, status: 'DRAFT',
    }).map(item => item.action), [
      'mip.admin.messageTemplates.activate', 'mip.admin.messageTemplates.archive',
    ])
    assert.deepEqual(messageTemplateRowActions({
      id: 'template-1', version: 5, status: 'ARCHIVED',
    }), [])

    assert.equal(communityReportRowActions({
      id: 'report-1', version: 1, status: 'PENDING',
    })[0]?.action, 'mip.admin.communityReports.claim')
    assert.deepEqual(communityReportRowActions({
      id: 'report-1', version: 2, status: 'REVIEWING',
    })[0]?.values, {
      reportId: 'report-1', expectedVersion: 2, outcome: 'RESOLVED', reason: '',
    })
    assert.deepEqual(communityReportRowActions({ status: 'PENDING', version: 1 }), [])
  })

  it('carries event policy and catalog versions into reachable actions', () => {
    assert.deepEqual(eventPolicyRowActions({ version: 0, cancellationHoursBeforeStart: 24 }), [{
      action: 'mip.admin.events.policy.save', label: '编辑政策',
      values: { expectedVersion: 0, cancellationHoursBeforeStart: 24 },
    }])
    const actions = eventCatalogRowActions({
      id: 'catalog-1', kind: 'TYPE', name: '工作坊', description: '互动活动',
      sortOrder: 10, version: 2, status: 'ACTIVE',
    })
    assert.deepEqual(actions.map(item => item.action), [
      'mip.admin.events.catalog.save',
      'mip.admin.events.catalog.changeStatus',
      'mip.admin.events.catalog.archive',
    ])
    assert.deepEqual(actions[0]?.values, {
      kind: 'TYPE', catalogId: 'catalog-1', expectedVersion: 2,
      name: '工作坊', description: '互动活动', sortOrder: 10,
    })
    assert.deepEqual(actions[1]?.values, {
      kind: 'TYPE', catalogId: 'catalog-1', expectedVersion: 2, status: 'INACTIVE',
    })
    assert.deepEqual(eventCatalogRowActions({
      id: 'catalog-1', kind: 'TYPE', sortOrder: 10, version: 2, status: 'ARCHIVED',
    }), [])
  })

  it('parses only structured launch facts and rejects malformed context', () => {
    assert.deepEqual(parseAdminOperationLaunchContext(JSON.stringify({
      values: { eventId: 'event-1' },
      expectedVersion: 0,
      allowedCapabilities: ['events.read', '', 'events.read'],
      unknown: 'ignored',
    })), {
      values: { eventId: 'event-1' },
      expectedVersion: 0,
      allowedCapabilities: ['events.read'],
    })
    assert.deepEqual(parseAdminOperationLaunchContext('{broken'), {})
    assert.deepEqual(parseAdminOperationLaunchContext(JSON.stringify([])), {})
  })
})
