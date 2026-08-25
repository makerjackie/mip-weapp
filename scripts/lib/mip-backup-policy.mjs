export const DEFAULT_BACKUP_MAX_AGE_HOURS = 24
export const MIN_BACKUP_MAX_AGE_HOURS = 24
export const MAX_BACKUP_MAX_AGE_HOURS = 168

const BACKUP_MAX_AGE_ARGUMENT = '--backup-max-age-hours='
const MAX_CLOCK_SKEW_MS = 300_000
const MILLISECONDS_PER_HOUR = 3_600_000

export function resolveBackupMaxAgeHours(argv = []) {
  const bareArgument = argv.includes('--backup-max-age-hours')
  const values = argv
    .filter(value => value.startsWith(BACKUP_MAX_AGE_ARGUMENT))
    .map(value => value.slice(BACKUP_MAX_AGE_ARGUMENT.length))

  if (bareArgument || values.length > 1) {
    throw new Error(
      `${BACKUP_MAX_AGE_ARGUMENT}<integer> may only be provided once`,
    )
  }
  if (values.length === 0) {
    return DEFAULT_BACKUP_MAX_AGE_HOURS
  }

  const [rawValue] = values
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(
      `Backup maximum age must be an integer from ${MIN_BACKUP_MAX_AGE_HOURS} to ${MAX_BACKUP_MAX_AGE_HOURS} hours`,
    )
  }

  const hours = Number(rawValue)
  if (hours < MIN_BACKUP_MAX_AGE_HOURS || hours > MAX_BACKUP_MAX_AGE_HOURS) {
    throw new Error(
      `Backup maximum age must be an integer from ${MIN_BACKUP_MAX_AGE_HOURS} to ${MAX_BACKUP_MAX_AGE_HOURS} hours`,
    )
  }
  return hours
}

export function assertBackupCompletedWithinMaxAge({
  completedAt,
  maxAgeHours = DEFAULT_BACKUP_MAX_AGE_HOURS,
  nowMs = Date.now(),
}) {
  assertAllowedMaxAgeHours(maxAgeHours)
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('Current time must be finite when validating a database backup')
  }

  const completedAtMs = Date.parse(completedAt)
  if (!Number.isFinite(completedAtMs)) {
    throw new TypeError('Database backup manifest has an invalid completion time')
  }

  const ageMs = nowMs - completedAtMs
  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    throw new Error('Database backup completion time is in the future')
  }
  if (ageMs > maxAgeHours * MILLISECONDS_PER_HOUR) {
    throw new Error(
      `Database backup must be completed within the last ${maxAgeHours} hours`,
    )
  }

  return Object.freeze({
    ageMs,
    completedAtMs,
    maxAgeHours,
  })
}

function assertAllowedMaxAgeHours(value) {
  if (
    !Number.isInteger(value)
    || value < MIN_BACKUP_MAX_AGE_HOURS
    || value > MAX_BACKUP_MAX_AGE_HOURS
  ) {
    throw new Error(
      `Backup maximum age must be an integer from ${MIN_BACKUP_MAX_AGE_HOURS} to ${MAX_BACKUP_MAX_AGE_HOURS} hours`,
    )
  }
}
