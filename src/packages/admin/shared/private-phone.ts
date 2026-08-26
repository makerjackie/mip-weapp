interface PhoneBearingRecord {
  id: string
  phoneNumber: string | null
}

const privatePhonesByPage = new WeakMap<object, Map<string, string>>()

function normalizedPhone(value: string | null) {
  const match = /^\+(\d{1,4}) (\d{6,20})$/.exec(String(value || '').trim())
  return match
    ? { countryCode: match[1], number: match[2], full: `+${match[1]} ${match[2]}` }
    : null
}

export function maskedPhone(value: string | null) {
  const phone = normalizedPhone(value)
  if (!phone) {
    return ''
  }
  const prefixLength = Math.min(3, phone.number.length - 4)
  const suffixLength = Math.min(4, phone.number.length - prefixLength - 2)
  return `+${phone.countryCode} ${phone.number.slice(0, prefixLength)}****${phone.number.slice(-suffixLength)}`
}

export function replacePrivatePhones(owner: object, items: PhoneBearingRecord[]) {
  const phones = new Map<string, string>()
  for (const item of items) {
    const phone = normalizedPhone(item.phoneNumber)
    if (phone) {
      phones.set(item.id, phone.full)
    }
  }
  privatePhonesByPage.set(owner, phones)
}

export function appendPrivatePhones(owner: object, items: PhoneBearingRecord[]) {
  const phones = privatePhonesByPage.get(owner) || new Map<string, string>()
  for (const item of items) {
    const phone = normalizedPhone(item.phoneNumber)
    if (phone) {
      phones.set(item.id, phone.full)
    }
  }
  privatePhonesByPage.set(owner, phones)
}

export function privatePhone(owner: object, id: string) {
  return privatePhonesByPage.get(owner)?.get(id) || ''
}

export function clearPrivatePhones(owner: object) {
  privatePhonesByPage.delete(owner)
}
