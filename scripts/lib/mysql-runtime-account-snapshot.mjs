import { callCloudbase, sqlLiteral } from './example-cloudbase.mjs'
import { parsePrivilegeRows } from './mysql-privilege-assert.mjs'

export function loadRuntimeAccountSnapshot(root, grantee) {
  return {
    tableRows: loadTablePrivilegeRows(root, grantee),
    schemaRows: queryPrivilegeRows(root, `SELECT table_schema AS tableSchema,
      privilege_type AS privilegeType, grantee
      FROM information_schema.schema_privileges
      WHERE grantee = ${sqlLiteral(grantee)}`),
    userRows: queryPrivilegeRows(root, `SELECT privilege_type AS privilegeType, grantee
      FROM information_schema.user_privileges
      WHERE grantee = ${sqlLiteral(grantee)}`),
  }
}

function loadTablePrivilegeRows(root, grantee) {
  const pageSize = 100
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const page = queryPrivilegeRows(root, `SELECT table_schema AS tableSchema,
      table_name AS tableName, privilege_type AS privilegeType, grantee
      FROM information_schema.table_privileges
      WHERE grantee = ${sqlLiteral(grantee)}
      ORDER BY table_schema, table_name, privilege_type
      LIMIT ${pageSize} OFFSET ${offset}`)
    rows.push(...page)
    if (page.length < pageSize) {
      return rows
    }
  }
}

function queryPrivilegeRows(root, sql) {
  return parsePrivilegeRows(callCloudbase(root, 'queryMysqlDatabase', {
    action: 'runQuery',
    sql,
  }))
}
