'use strict'

const mysql = require('mysql2/promise')
const retryableErrors = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])

function createMysqlDatabase(options = {}) {
  const pool = options.pool || mysql.createPool(connectionOptions(options))
  async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params)
    return rows
  }
  async function one(sql, params = []) {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? rows[0] || null : null
  }
  async function transaction(work, attempts = 3) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const connection = await pool.getConnection()
      try {
        await connection.query("SET time_zone = '+00:00'")
        await connection.beginTransaction()
        const tx = {
          async query(sql, params = []) {
            const [rows] = await connection.execute(sql, params)
            return rows
          },
          async one(sql, params = []) {
            const [rows] = await connection.execute(sql, params)
            return rows[0] || null
          },
        }
        const result = await work(tx)
        await connection.commit()
        return result
      }
      catch (error) {
        lastError = error
        await connection.rollback().catch(() => {})
        if (!retryableErrors.has(error?.code) || attempt === attempts) throw error
      }
      finally {
        connection.release()
      }
    }
    throw lastError
  }
  return { one, query, transaction }
}

function connectionOptions(options) {
  const uri = options.connectionUri || process.env.MIP_DB_CONNECTION_URI
  if (!uri) throw new Error('MYSQL_CONFIG_REQUIRED')
  const parsed = new URL(uri)
  if (parsed.protocol !== 'mysql:' || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) {
    throw new Error('MYSQL_CONFIG_REQUIRED')
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    ssl: parsed.searchParams.get('ssl') === 'true' ? {} : undefined,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 16,
    connectTimeout: 8000,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
  }
}

let sharedDatabase
function mysqlDatabase() {
  sharedDatabase ||= createMysqlDatabase()
  return sharedDatabase
}

module.exports = { createMysqlDatabase, mysqlDatabase }
