import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudbaseMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  ADMIN_REQUEST_CONTRACT_VERSION,
  createAdminRequest,
} from '../src/modules/mip-admin/request-contract'
import { mipKnowledgeAdminModule } from '../src/modules/mip-knowledge/admin'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
}))

vi.mock('../src/platform/cloudbase/client', () => ({
  requireCloudClient: vi.fn(async () => ({ callFunction: cloudHarness.callFunction })),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

describe('MIP admin request contract', () => {
  beforeEach(() => {
    cloudHarness.callFunction.mockReset()
  })

  it('moves idempotency to the v1 envelope without mutating business input', () => {
    const input = {
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 5,
      action: 'PUBLISH',
      reason: '内容符合要求',
      idempotencyKey: 'moderate-comment-request-a',
    }
    const snapshot = structuredClone(input)

    expect(createAdminRequest('mip.admin.opportunityComments.moderate', input)).toEqual({
      contractVersion: ADMIN_REQUEST_CONTRACT_VERSION,
      action: 'mip.admin.opportunityComments.moderate',
      input: {
        opportunityId: 'opportunity-a',
        commentId: 'comment-a',
        expectedVersion: 5,
        action: 'PUBLISH',
        reason: '内容符合要求',
      },
      idempotencyKey: 'moderate-comment-request-a',
    })
    expect(input).toEqual(snapshot)
    expect(() => createAdminRequest('mip.admin.events.clone', {
      idempotencyKey: 42,
    })).toThrow('Admin request idempotencyKey must be a string')
  })

  it('uses the v1 builder for the main admin CloudBase transport', async () => {
    cloudHarness.callFunction.mockResolvedValueOnce({
      result: { ok: true, data: { id: 'comment-a', status: 'HIDDEN', version: 6 } },
    })

    await cloudbaseMipAdminGateway.moderateOpportunityComment({
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 5,
      action: 'HIDE',
      reason: '内容不符合要求',
    })

    expect(cloudHarness.callFunction).toHaveBeenCalledWith({
      name: expect.any(String),
      data: {
        contractVersion: 1,
        action: 'mip.admin.opportunityComments.moderate',
        input: {
          opportunityId: 'opportunity-a',
          commentId: 'comment-a',
          expectedVersion: 5,
          action: 'HIDE',
          reason: '内容不符合要求',
        },
      },
    })
  })

  it('uses the v1 builder for knowledge administration and lifts its request key', async () => {
    cloudHarness.callFunction.mockResolvedValueOnce({
      result: { ok: true, data: { id: 'run-a' } },
    })

    await mipKnowledgeAdminModule.runIngestion('source-a', 'category-a')

    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(1)
    const request = cloudHarness.callFunction.mock.calls[0][0]
    expect(request).toMatchObject({
      name: expect.any(String),
      data: {
        contractVersion: 1,
        action: 'mip.admin.knowledge.ingestion.run',
        input: { sourceId: 'source-a', categoryId: 'category-a' },
        idempotencyKey: expect.any(String),
      },
    })
    expect(request.data.input).not.toHaveProperty('idempotencyKey')
  })

  it('uses the normalized route action for outbox wakeup decisions', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../cloudfunctions/mip-admin-api/index.js'),
      'utf8',
    )
    expect(source).toMatch(/routeAction = normalizeAdminRequest\(event\)\.action/)
    expect(source).toMatch(/action: routeAction/)
    expect(source).not.toMatch(/action: String\(event\.action/)
  })
})
