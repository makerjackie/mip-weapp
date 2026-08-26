interface PhoneBearingRecord {
  id: string
  phoneNumber: string | null
}

const privatePhonesByPage = new WeakMap<object, Map<string, string>>()

function normalizedPhone(value: string | null) {
  const input = String(value || '').trim()
  if (!/^\+?[\d\s()-]+$/.test(input)) {
    return ''
  }
  const digits = input.replace(/\D/g, '')
  const mainlandPhone = digits.startsWith('86') && digits.length === 13
    ? digits.slice(2)
    : digits
  return /^1[3-9]\d{9}$/.test(mainlandPhone) ? mainlandPhone : ''
}

export function maskedPhone(value: string | null) {
  const phone = normalizedPhone(value)
  return phone ? `${phone.slice(0, 3)} **** ${phone.slice(-4)}` : ''
}

export function replacePrivatePhones(owner: object, items: PhoneBearingRecord[]) {
  const phones = new Map<string, string>()
  for (const item of items) {
    const phone = normalizedPhone(item.phoneNumber)
    if (phone) {
      phones.set(item.id, phone)
    }
  }
  privatePhonesByPage.set(owner, phones)
}

export function appendPrivatePhones(owner: object, items: PhoneBearingRecord[]) {
  const phones = privatePhonesByPage.get(owner) || new Map<string, string>()
  for (const item of items) {
    const phone = normalizedPhone(item.phoneNumber)
    if (phone) {
      phones.set(item.id, phone)
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
