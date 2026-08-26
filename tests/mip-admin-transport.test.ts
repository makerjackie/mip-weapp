import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { createCloudBaseAdminTransport } from '../src/modules/mip-admin/cloudbase-transport'
import { createAdminRequest } from '../src/modules/mip-admin/request-contract'
import { createInMemoryAdminTransport } from '../src/modules/mip-admin/transport'
import { createMipKnowledgeAdminModule } from '../src/modules/mip-knowledge/admin'

const defaultCloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
}))

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(async () => ({ callFunction: defaultCloudHarness.callFunction })),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

describe('MIP admin transports', () => {
  beforeEach(() => {
    defaultCloudHarness.callFunction.mockReset()
  })

  it('uses one v1 request contract across CloudBase and in-memory adapters', async () => {
    const callFunction = vi.fn(async () => ({
      result: { ok: true, data: { source: 'cloudbase' } },
    }))
    const cloudbase = createCloudBaseAdminTransport({
      cloudClient: { callFunction },
      functionName: 'mip-admin-api-test',
    })
    const handledInputs: Array<Record<string, unknown>> = []
    const inMemory = createInMemoryAdminTransport({
      'mip.admin.growth.adjust': (input) => {
        handledInputs.push(input)
        return { source: 'memory' }
      },
    })
    const request = createAdminRequest('mip.admin.growth.adjust', {
      userId: 'user-a',
      expectedVersion: 3,
      idempotencyKey: 'adjust-a',
    })
    const snapshot = structuredClone(request)

    await expect(cloudbase.request(request)).resolves.toEqual({ source: 'cloudbase' })
    await expect(inMemory.request(request)).resolves.toEqual({ source: 'memory' })

    expect(callFunction).toHaveBeenCalledWith({
      name: 'mip-admin-api-test',
      data: request,
    })
    expect(handledInputs).toEqual([{
      userId: 'user-a',
      expectedVersion: 3,
      idempotencyKey: 'adjust-a',
    }])
    expect(request).toEqual(snapshot)
    expect(request.input).not.toHaveProperty('idempotencyKey')
  })

  it('keeps query cold-start retry inside the CloudBase adapter only', async () => {
    const queryCall = vi.fn()
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: { enabled: true } } })
    const queryTransport = createCloudBaseAdminTransport({
      cloudClient: { callFunction: queryCall },
    })

    await expect(queryTransport.request(createAdminRequest('mip.admin.session')))
      .resolves
      .toEqual({ enabled: true })
    expect(queryCall).toHaveBeenCalledTimes(2)

    const mutationCall = vi.fn(async () => {
      throw new Error('write failed')
    })
    const mutationTransport = createCloudBaseAdminTransport({
      cloudClient: { callFunction: mutationCall },
    })
    const mutationRequest = createAdminRequest('mip.admin.users.update', {
      userId: 'user-a',
      idempotencyKey: 'user-update-request-a',
    })
    await expect(mutationTransport.request(mutationRequest))
      .rejects
      .toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true })
    expect(mutationCall).toHaveBeenCalledTimes(1)
    expect(mutationCall).toHaveBeenCalledWith({
      name: 'mip-admin-api',
      data: {
        contractVersion: 1,
        action: 'mip.admin.users.update',
        input: { userId: 'user-a' },
        idempotencyKey: 'user-update-request-a',
      },
    })

    const inMemoryHandler = vi.fn(() => {
      throw new Error('local failure')
    })
    const inMemory = createInMemoryAdminTransport({
      'mip.admin.session': inMemoryHandler,
    })
    await expect(inMemory.request(createAdminRequest('mip.admin.session')))
      .rejects
      .toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true })
    expect(inMemoryHandler).toHaveBeenCalledTimes(1)
  })

  it('retries knowledge reads, keeps writes single-shot, and never replays business errors', async () => {
    const knowledgeRead = vi.fn()
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: { items: [] } } })
    const readTransport = createCloudBaseAdminTransport({
      cloudClient: { callFunction: knowledgeRead },
    })

    await expect(readTransport.request(createAdminRequest('mip.admin.knowledge.list')))
      .resolves
      .toEqual({ items: [] })
    expect(knowledgeRead).toHaveBeenCalledTimes(2)

    const responseLost = vi.fn(async () => {
      throw new Error('response lost')
    })
    const writeTransport = createCloudBaseAdminTransport({
      cloudClient: { callFunction: responseLost },
    })
    await expect(writeTransport.request(createAdminRequest('mip.admin.knowledge.contents.save', {
      contentId: 'content-a',
    }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true })
    expect(responseLost).toHaveBeenCalledOnce()

    const businessError = vi.fn(async () => ({
      result: {
        ok: false,
        error: { code: 'CONFLICT', message: '内容状态已变化', retryable: true },
      },
    }))
    const errorTransport = createCloudBaseAdminTransport({
      cloudClient: { callFunction: businessError },
    })
    await expect(errorTransport.request(createAdminRequest('mip.admin.knowledge.get', {
      contentId: 'content-a',
    }))).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '内容状态已变化',
      retryable: true,
    })
    expect(businessError).toHaveBeenCalledOnce()
  })

  it('exposes the same stable error contract for remote and in-memory failures', async () => {
    const callFunction = vi.fn(async () => ({
      result: {
        ok: false,
        error: { code: 'NOT_FOUND', message: '运营操作不存在', retryable: false },
      },
    }))
    const cloudbase = createCloudBaseAdminTransport({ cloudClient: { callFunction } })
    const inMemory = createInMemoryAdminTransport({})
    const request = createAdminRequest('mip.admin.unknown')
    const expectedError = {
      name: 'MipAdminError',
      code: 'NOT_FOUND',
      message: '运营操作不存在',
      retryable: false,
      details: null,
    }

    await expect(cloudbase.request(request)).rejects.toMatchObject(expectedError)
    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(callFunction).toHaveBeenCalledWith({
      name: 'mip-admin-api',
      data: request,
    })
    await expect(inMemory.request(request)).rejects.toMatchObject(expectedError)
    await expect(inMemory.request(createAdminRequest('toString'))).rejects.toMatchObject(expectedError)
  })

  it('keeps gateway DTO behavior behind an injected transport', async () => {
    const session = { enabled: true, capabilities: [], roles: [] }
    const handledInputs: Array<Record<string, unknown>> = []
    const transport = createInMemoryAdminTransport({
      'mip.admin.session': () => session,
      'mip.admin.opportunityComments.moderate': (input) => {
        handledInputs.push(input)
        return { id: 'comment-a', status: 'HIDDEN', version: 4 }
      },
    })
    const gateway = createMipAdminGateway(transport)

    await expect(gateway.getSession()).resolves.toEqual(session)
    await expect(gateway.moderateOpportunityComment({
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 3,
      action: 'HIDE',
      reason: '内容不符合要求',
    })).resolves.toEqual({ id: 'comment-a', status: 'HIDDEN', version: 4 })
    expect(handledInputs).toEqual([{
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 3,
      action: 'HIDE',
      reason: '内容不符合要求',
    }])
  })

  it('runs knowledge administration through the neutral transport seam', async () => {
    const handledInputs: Array<Record<string, unknown>> = []
    const transport = createInMemoryAdminTransport({
      'mip.admin.knowledge.get': (input) => {
        handledInputs.push(input)
        return { id: input.contentId, title: '示例内容' }
      },
    })
    const knowledge = createMipKnowledgeAdminModule(transport)

    await expect(knowledge.getContent('content-a')).resolves.toEqual({
      id: 'content-a',
      title: '示例内容',
    })
    expect(handledInputs).toEqual([{ contentId: 'content-a' }])
  })
})
