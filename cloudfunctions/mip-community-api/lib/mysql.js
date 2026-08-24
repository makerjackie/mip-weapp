'use strict'

const mysql = require('mysql2/promise')

const RETRYABLE_TRANSACTION_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function connectionOptions(options = {}) {
  const shared = {
    waitForConnections: true,
    connectionLimit: positiveInteger(options.connectionLimit || process.env.MIP_DB_POOL_SIZE, 4),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
  }
  const uri = options.connectionUri || process.env.MIP_DB_CONNECTION_URI
  if (uri) {
    const parsed = new URL(uri)
    return {
      ...shared,
      host: parsed.hostname,
      port: positiveInteger(parsed.port, 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      ssl: parsed.searchParams.get('ssl') === 'true' ? {} : undefined,
    }
  }
  const host = options.host || process.env.MIP_DB_HOST
  const user = options.user || process.env.MIP_DB_USER
  const password = options.password || process.env.MIP_DB_PASSWORD
  const database = options.database || process.env.MIP_DB_NAME
  if (!host || !user || !password || !database) {
    throw new Error('SERVICE_UNAVAILABLE')
  }
  return {
    ...shared,
    host,
    port: positiveInteger(options.port || process.env.MIP_DB_PORT, 3306),
    user,
    password,
    database,
  }
}

function createMysqlDatabase(options = {}) {
  const pool = options.pool || mysql.createPool(connectionOptions(options))

  async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params)
    return rows
  }

  async function one(sql, params = []) {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? (rows[0] || null) : null
  }

  async function transaction(work, { attempts = 3 } = {}) {
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
        await connection.rollback().catch(() => undefined)
        if (!RETRYABLE_TRANSACTION_ERRORS.has(error?.code) || attempt === attempts) {
          throw error
        }
      }
      finally {
        connection.release()
      }
    }
    throw lastError
  }

  return { one, query, transaction }
}

let database

function mysqlDatabase() {
  database ||= createMysqlDatabase()
  return database
}

module.exports = { createMysqlDatabase, mysqlDatabase }
