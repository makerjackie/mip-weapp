const MINIMUM_MYSQL_VERSION = Object.freeze({ major: 8, minor: 0, patch: 22 })

export function parseMySqlVersion(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || /mariadb/i.test(text)) {
    return null
  }
  const match = text.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:$|[-+_])/)
  if (!match) {
    return null
  }
  const version = {
    raw: text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] || 0),
  }
  if (![version.major, version.minor, version.patch].every(Number.isSafeInteger)) {
    return null
  }
  return version
}

export function isSupportedMySqlVersion(value) {
  const version = typeof value === 'object' && value !== null
    ? value
    : parseMySqlVersion(value)
  if (!version
    || !Number.isSafeInteger(version.major)
    || !Number.isSafeInteger(version.minor)
    || !Number.isSafeInteger(version.patch)) {
    return false
  }
  if (version.major !== MINIMUM_MYSQL_VERSION.major) {
    return version.major > MINIMUM_MYSQL_VERSION.major
  }
  if (version.minor !== MINIMUM_MYSQL_VERSION.minor) {
    return version.minor > MINIMUM_MYSQL_VERSION.minor
  }
  return version.patch >= MINIMUM_MYSQL_VERSION.patch
}

export function assertSupportedMySqlVersion(value) {
  const version = parseMySqlVersion(value)
  if (!version || !isSupportedMySqlVersion(version)) {
    throw new Error('CloudBase MySQL 8.0.22 or newer is required')
  }
  return version
}

export { MINIMUM_MYSQL_VERSION }
