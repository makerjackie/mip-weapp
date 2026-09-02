import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP knowledge content contract', () => {
  it('adds an isolated replay-safe knowledge schema and rollback without destructive source data changes', () => {
    const migration = read('database/mysql/mip/036_mip_knowledge_content.sql')
    const rollback = read('database/mysql/mip/rollback/036_mip_knowledge_content.sql')
    for (const table of [
      'mip_knowledge_sources',
      'mip_knowledge_categories',
      'mip_knowledge_contents',
      'mip_knowledge_products',
      'mip_knowledge_entitlements',
      'mip_content_comments',
      'mip_content_comment_reports',
      'mip_knowledge_ingestion_runs',
    ]) {
      expect(migration).toContain(table)
      expect(rollback).toContain(table)
    }
    expect(migration).toContain('order_type IN (\'MEMBERSHIP\', \'EVENT\', \'CONTENT\')')
    expect(migration).not.toMatch(/\b(TRUNCATE TABLE|DELETE FROM)\b/i)
  })

  it('registers public content routes', () => {
    const app = JSON.parse(read('src/app.json')) as {
      subPackages: Array<{ root: string, pages: string[] }>
    }
    const member = app.subPackages.find(item => item.root === 'packages/member')
    expect(member?.pages).toEqual(expect.arrayContaining([
      'mip-knowledge/index',
      'mip-knowledge/detail/index',
      'mip-knowledge/web/index',
    ]))
  })

  it('keeps payment and private video capabilities behind module and device boundaries', () => {
    const page = read('src/packages/member/mip-knowledge/detail/index.ts')
    const module = read('src/modules/mip-knowledge/module.ts')
    const client = read('src/modules/mip-knowledge/client.ts')
    const gateway = read('src/modules/mip-knowledge/cloudbase-gateway.ts')
    const runtime = read('config/runtime-pages.json')
    expect(page).toContain('mipKnowledgeModule.purchase')
    expect(page).toContain('mipIdentityModule.beginProtectedAction')
    expect(page).toContain('wx.openChannelsActivity')
    expect(page).not.toContain('wx.requestPayment')
    expect(module).toContain('createMipKnowledgeModule')
    expect(module).not.toContain('runtimeConfig')
    expect(module).not.toContain('requireCloudClient')
    expect(module).not.toContain('mipCommerceModule')
    expect(client).toContain('paymentEnabled: runtimeConfig.paymentMode !== \'disabled\'')
    expect(gateway).toContain('\'createKnowledgeCheckout\'')
    expect(runtime).toContain('knowledge-webview')
    expect(runtime).toContain('video-channel')
    expect(read('src/config/runtime.ts')).toContain('knowledgeWebviewAllowedHosts')
    expect(read('src/packages/member/mip-knowledge/web/index.ts')).toContain('knowledgeWebviewAllowedHosts')
  })

  it('provides controlled manual ingestion without installing a timer', () => {
    const admin = read('cloudfunctions/mip-admin-api/domain/knowledge.js')
    const cloudConfig = read('cloudfunctions/mip-admin-api/config.json')
    expect(admin).toContain('runKnowledgeIngestion')
    expect(admin).toContain('mip_knowledge_ingestion_runs')
    expect(admin).toContain('DUPLICATE')
    expect(admin).toContain('\'PENDING_REVIEW\', \'PENDING\'')
    expect(cloudConfig).not.toMatch(/timer|cron/i)
    expect(read('.env.example')).toContain('MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS=')
    expect(read('.env.example')).toContain('MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS=')
  })

  it('uses immutable order snapshots for amount, entitlement and pre-access refund checks', () => {
    const commerce = read('cloudfunctions/mip-commerce-api/domain/repository.js')
    const ledger = read('cloudfunctions/mip-payment-ledger/domain/ledger.js')
    expect(commerce).toContain('snapshot.priceCents')
    expect(commerce).toContain('snapshot.refundPolicy')
    expect(commerce).toContain('first_accessed_at')
    expect(ledger).toContain('snapshot.unlockDays')
    expect(ledger).toContain('mip_knowledge_entitlements')
  })
})
