import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP received interaction client flow', () => {
  it('keeps one reachable member page with two factual categories and identity access', () => {
    const page = read('src/packages/member/mip-received/index.ts')
    const view = read('src/packages/member/mip-received/index.wxml')
    const profile = read('src/pages/profile/index.wxml')

    expect(page).toContain('action: \'INTERACT\'')
    expect(page).toContain('loadCategory(\'REFERRAL\', true)')
    expect(page).toContain('loadCategory(\'PROFILE_INTEREST\', true)')
    expect(page).toContain('opportunityModule.listReceived(')
    expect(page).toContain('markReceivedRead')
    expect(page).toContain('mipMessagingModule.invalidate()')
    expect(page).not.toContain('wx.cloud')
    expect(view).toContain('引荐给我的')
    expect(view).toContain('对我感兴趣')
    expect(view).toContain('state === \'loading\'')
    expect(view).toContain('state === \'empty\'')
    expect(view).toContain('state === \'error\'')
    expect(profile).toContain('bind:tap="openReceivedInteractions"')
  })

  it('declares the page in every active route contract', () => {
    const route = 'packages/member/mip-received/index'
    const app = JSON.parse(read('src/app.json'))
    const project = JSON.parse(read('config/project.json'))
    const runtime = JSON.parse(read('config/runtime-pages.json'))
    const member = app.subPackages.find((item: { root: string }) => item.root === 'packages/member')

    expect(member.pages).toContain('mip-received/index')
    expect(project.routes.some((item: { pathName: string }) => item.pathName === route)).toBe(true)
    expect(runtime.routes.find((item: { path: string }) => item.path === route)).toMatchObject({
      selector: '#mip-received-interactions-page',
      states: expect.arrayContaining(['loading', 'ready', 'empty', 'error', 'access']),
    })
    expect(runtime.routeCount).toBe(runtime.routes.length)
  })

  it('treats received listing as retriable read and read marking as a single-attempt mutation', () => {
    const transport = read('src/modules/mip-opportunities/transport.ts')
    const client = read('src/modules/mip-opportunities/client.ts')
    expect(transport).toContain('\'listReceivedInteractions\'')
    expect(transport).not.toMatch(/readActions[\s\S]*?'markReceivedInteractionRead'/)
    expect(client).toContain('callOpportunityApi<ReceivedInteractionPage>(\'listReceivedInteractions\'')
    expect(client).toContain('callOpportunityApi<{ messageId: string, readAt: string }>(\'markReceivedInteractionRead\'')
  })
})
