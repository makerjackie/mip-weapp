const LEGACY_SCHEMA_CONFIRMATION = '--confirm-legacy-member-schema'
const TEST_DATABASE_CONFIRMATION = '--confirm-test-database'

export function assertLegacyMemberSchemaInvocation(argv = []) {
  const args = new Set(argv)
  if (!args.has(LEGACY_SCHEMA_CONFIRMATION) || !args.has(TEST_DATABASE_CONFIRMATION)) {
    throw new Error(
      `Legacy non-MIP member_* schema application is disabled; only an isolated legacy test workflow may pass both ${LEGACY_SCHEMA_CONFIRMATION} and ${TEST_DATABASE_CONFIRMATION}`,
    )
  }
  return Object.freeze({ workflow: 'legacy-non-mip', testDatabaseConfirmed: true })
}

export { LEGACY_SCHEMA_CONFIRMATION, TEST_DATABASE_CONFIRMATION }
