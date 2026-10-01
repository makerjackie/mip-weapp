import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionUserSelect } from './session-user-select'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../app/session-provider', () => ({ useAdminSession: () => ({ request }) }))
afterEach(() => { cleanup(); request.mockReset() })

it('searches message recipients by name and selects the server profile reference', async () => {
  request.mockResolvedValue({ items: [{ profileRef: 'opaque-recipient-ref', nickname: 'Maker Jackie' }], nextCursor: null })
  const selected = vi.fn()
  const user = userEvent.setup()
  render(<SessionUserSelect multiple action="mip.admin.messageCampaigns.recipients" input={{ branchId: 'branch-a' }} onChange={selected} />)
  const search = screen.getByRole('combobox')
  await user.click(search)
  await user.type(search, 'Maker')
  await waitFor(() => expect(request).toHaveBeenCalledWith('mip.admin.messageCampaigns.recipients', { branchId: 'branch-a', query: 'Maker', limit: 50 }))
  await user.click(screen.getAllByText('Maker Jackie').at(-1)!)
  expect(selected).toHaveBeenCalledWith(['opaque-recipient-ref'])
})
