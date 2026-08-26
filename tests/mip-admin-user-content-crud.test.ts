import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('admin user content CRUD contract', () => {
  it('exposes owner-bound save and soft archive methods', async () => {
    const calls: unknown[] = []
    const module = createMipAdminModule({
      listUserContent: async () => ({ items: [], nextCursor: null }),
      getUserContent: async () => { throw new Error('not used') },
      unpublishUserContent: async () => ({ id: 'x', kind: 'SUPER_CASE', status: 'UNPUBLISHED', version: 2 }),
      saveUserContent: async (input) => {
        calls.push(['save', input])
        return { id: 'x', kind: input.kind, status: input.draft.status || 'DRAFT', version: 1 }
      },
      archiveUserContent: async (input) => {
        calls.push(['archive', input])
        return { id: input.contentId, kind: input.kind, status: 'ARCHIVED', version: input.expectedVersion + 1 }
      },
    })
    await module.userContent.save({
      kind: 'SUPER_CASE',
      ownerUserId: '10000000-0000-4000-8000-000000000001',
      draft: {
        kind: 'SUPER_CASE',
        projectName: '案例',
        summary: '摘要',
        startedOn: null,
        endedOn: null,
        responsibility: '责任',
        cityTagId: null,
        industryTagId: null,
        caseType: null,
        description: '说明',
        coverAssetId: null,
        mediaAssetIds: [],
        status: 'DRAFT',
      },
    })
    await module.userContent.archive({ kind: 'SUPER_CASE', contentId: '10000000-0000-4000-8000-000000000002', expectedVersion: 2, reason: '历史内容' })
    expect(calls).toHaveLength(2)
    expect((calls[0] as Array<unknown>)[1]).toMatchObject({ ownerUserId: '10000000-0000-4000-8000-000000000001' })
  })

  it('registers a separate responsive editor route and keeps the governance page actionable', () => {
    const app = JSON.parse(read('src/app.json')) as { subPackages: Array<{ root: string, pages: string[] }> }
    const admin = app.subPackages.find(item => item.root === 'packages/admin')
    expect(admin?.pages).toContain('user-content-editor/index')
    expect(read('config/runtime-pages.json')).toContain('"id": "A46"')
    expect(read('src/packages/admin/user-content/index.wxml')).toContain('编辑内容')
    expect(read('src/packages/admin/user-content-editor/index.ts')).toContain('ownerUserId')
    expect(read('src/packages/admin/user-content/index.wxml')).toContain('不执行物理删除')
  })
})
