export interface CardPreviewIdentityInput {
  nickname?: string
  realName?: string
}

export interface CardPreviewIdentity {
  name: string
  initial: string
}

export function cardPreviewIdentity(input: CardPreviewIdentityInput): CardPreviewIdentity {
  const realName = String(input.realName || '').trim()
  const nickname = String(input.nickname || '').trim()
  const name = realName || nickname || 'MIP 成员'
  return { name, initial: name.slice(0, 1) }
}
