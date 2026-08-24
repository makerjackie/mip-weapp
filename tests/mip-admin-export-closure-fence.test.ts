import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start)
  const endAt = source.indexOf(end, startAt + start.length)
  expect(startAt).toBeGreaterThanOrEqual(0)
  expect(endAt).toBeGreaterThan(startAt)
  return source.slice(startAt, endAt)
}

describe('MIP admin export account-closure fence', () => {
  it('keeps storage validation and URL issuance inside the repository transaction callback', () => {
    const service = between(
      read('cloudfunctions/mip-admin-api/domain/service.js'),
      'async function reserveExportDownload',
      'async function completeExportDownload',
    )
    const repository = between(
      read('cloudfunctions/mip-admin-api/domain/repository.js'),
      'async function issueExportDownload',
      'async function consumeExportDownload',
    )

    expect(service).toContain('repository.issueExportDownload')
    expect(service).toContain('exportStorage.read')
    expect(service).toContain('exportStorage.temporaryUrl')
    expect(service).not.toContain('claimExportDownload')
    expect(repository.indexOf('authorizedExportTicket(tx, input)')).toBeLessThan(
      repository.indexOf('await issue(ticket)'),
    )
    expect(repository.indexOf('await issue(ticket)')).toBeLessThan(
      repository.indexOf('SET status = \'RESERVED\''),
    )
    expect(repository.indexOf('SET status = \'RESERVED\'')).toBeLessThan(
      repository.indexOf('await writeAudit(tx, input.audit)'),
    )
    expect(repository).toMatch(/\}, 1\)\s*\}\s*$/)
  })

  it('documents the bounded residual window for already-issued CloudBase URLs', () => {
    const contract = read('docs/ACCOUNT_CLOSURE.md')
    expect(contract).toContain('最终授权事务')
    expect(contract).toContain('当前有效期不超过 120 秒')
    expect(contract).toContain('剩余风险')
    expect(contract).toContain('禁用死锁自动重试')
    expect(contract).toContain('SDK 调用本身无法强制取消')
    expect(contract).toContain('不返回客户端')
  })
})
