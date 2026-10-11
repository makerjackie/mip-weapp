export interface CardPreviewIdentityInput {
  nickname?: string
  realName?: string
}

export interface CardPreviewIdentity {
  name: string
  initial: string
}

export function cardPreviewIdentity(input: CardPreviewIdentityInput, fallback = 'MIP 成员'): CardPreviewIdentity {
  const realName = String(input.realName || '').trim()
  const nickname = String(input.nickname || '').trim()
  const name = realName || nickname || fallback
  return { name, initial: name.slice(0, 1) }
}
