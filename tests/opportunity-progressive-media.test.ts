import { expect, it, vi } from 'vitest'
import { callOpportunityApi } from '../src/modules/mip-opportunities/transport'
import { requireCloudClient } from '../src/platform/cloudbase/client'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: { cloudbase: { opportunitiesFunctionName: 'test' } } }))

it('returns opportunity list data before downloading its covers', async () => {
  const data = { items: [{ title: '机会', coverUrl: 'cloud://test/slow.jpg' }] }
  const downloadFile = vi.fn(() => new Promise(() => {}))
  vi.mocked(requireCloudClient).mockResolvedValue({
    callFunction: vi.fn().mockResolvedValue({ result: { ok: true, data } }),
    downloadFile,
  } as never)
  await expect(callOpportunityApi('listOpportunities')).resolves.toEqual(data)
  expect(downloadFile).not.toHaveBeenCalled()
})
