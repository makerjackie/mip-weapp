import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function mysqlAdapters() {
  return fs.readdirSync(path.join(root, 'cloudfunctions'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mip-'))
    .map(entry => path.join(root, 'cloudfunctions', entry.name, 'lib', 'mysql.js'))
    .filter(filePath => fs.existsSync(filePath))
}

describe('Cloud Function MySQL adapters', () => {
  it('use the parameterized text protocol for MySQL 8 pagination compatibility', () => {
    const adapters = mysqlAdapters()

    expect(adapters).toHaveLength(16)
    for (const filePath of adapters) {
      const source = fs.readFileSync(filePath, 'utf8')
      expect(source, path.relative(root, filePath)).toContain('function safeQueryParams(params)')
      expect(source, path.relative(root, filePath)).toContain('pool.query(sql, safeQueryParams(params))')
      expect(source, path.relative(root, filePath)).not.toMatch(/\b(?:pool|connection)\.execute\(/)
      expect(source, path.relative(root, filePath)).not.toMatch(/\b(?:pool|connection)\.query\(sql, params\)/)
    }
  })
})
