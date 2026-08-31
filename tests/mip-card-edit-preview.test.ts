import { describe, expect, it } from 'vitest'
import { cardPreviewIdentity } from '../src/packages/member/mip-card-edit/preview'

describe('MIP card edit preview identity', () => {
  it('prefers the edited real name and updates the initial', () => {
    expect(cardPreviewIdentity({ realName: '林夏', nickname: '夏夏' })).toEqual({ name: '林夏', initial: '林' })
  })

  it('falls back to the profile nickname when the edited name is cleared', () => {
    expect(cardPreviewIdentity({ realName: '  ', nickname: '夏夏' })).toEqual({ name: '夏夏', initial: '夏' })
  })
})
