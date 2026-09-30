import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EventMobilePreview } from './event-mobile-preview'

afterEach(cleanup)

describe('event preview online access', () => {
  it('does not promise a venue link that an offline save discards', () => {
    render(<EventMobilePreview values={{ eventMode: 'OFFLINE', onlineUrl: 'https://example.com/venue' }} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows the HTTPS online link for hybrid activities', () => {
    render(<EventMobilePreview values={{ eventMode: 'HYBRID', onlineUrl: 'https://example.com/meeting' }} />)
    expect(screen.getByRole('link', { name: '线上活动链接' })).toHaveAttribute('href', 'https://example.com/meeting')
  })
})
