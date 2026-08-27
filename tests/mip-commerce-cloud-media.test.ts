import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudbaseMipCommerceTransport } from '../src/modules/mip-commerce/cloudbase-gateway'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
  downloadFile: vi.fn(),
  getTempFileURL: vi.fn(),
  uploadFile: vi.fn(),
}))

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(async () => cloudHarness),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: {
    cloudbase: {
      commerceFunctionName: 'mip-commerce-api',
      paymentFunctionName: 'mip-cloudpay',
    },
  },
}))

describe('MIP commerce CloudBase media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cloudHarness.callFunction.mockResolvedValue({
      result: {
        ok: true,
        data: [{
          id: 'order-1',
          event: { coverUrl: 'cloud://mip-test/events/event-1/cover.jpg' },
        }],
      },
    })
    cloudHarness.downloadFile.mockResolvedValue({
      tempFilePath: 'wxfile://tmp/event-cover.jpg',
      statusCode: 200,
      errMsg: 'downloadFile:ok',
    })
    cloudHarness.getTempFileURL.mockResolvedValue({ fileList: [], errMsg: 'getTempFileURL:ok' })
  })

  it('resolves nested event cover IDs before order data reaches a page', async () => {
    await expect(cloudbaseMipCommerceTransport.invoke(
      'mip-commerce-api',
      'listOrders',
      {},
      true,
    )).resolves.toEqual({
      ok: true,
      data: [{
        id: 'order-1',
        event: { coverUrl: 'wxfile://tmp/event-cover.jpg' },
      }],
    })
    expect(cloudHarness.downloadFile).toHaveBeenCalledWith({
      fileID: 'cloud://mip-test/events/event-1/cover.jpg',
    })
  })
})
