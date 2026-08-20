'use strict'

const mysql = require('mysql2/promise')

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function connectionOptions() {
  const uri = process.env.MEMBERSHIP_DB_CONNECTION_URI
  if (!uri) {
    throw new Error('MYSQL_CONFIG_REQUIRED')
  }
  const parsed = new URL(uri)
  return {
    host: parsed.hostname,
    port: positiveInteger(parsed.port, 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: positiveInteger(process.env.MEMBERSHIP_DB_POOL_SIZE, 4),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
  }
}

function createMysqlDatabase(options = {}) {
  const pool = options.pool || mysql.createPool(connectionOptions())

  async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params)
    return rows
  }

  async function one(sql, params = []) {
    const rows = await query(sql, params)
    return Array.isArray(rows) ? (rows[0] || null) : null
  }

  async function transaction(work) {
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
      await connection.rollback()
      throw error
    }
    finally {
      connection.release()
    }
  }

  return { one, query, transaction }
}

let database
function mysqlDatabase() {
  database ||= createMysqlDatabase()
  return database
}

module.exports = { createMysqlDatabase, mysqlDatabase }
