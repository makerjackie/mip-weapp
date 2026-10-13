import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  ))
}

// MIW-85 INVITER-01/02 依赖的全部邀请人绑定面（6 处，grep inviter-name= 实测）：
// 任一处被移除都意味着展示位口径变化，须先对齐 spec 再改本清单。
const inviterBoundSurfaces = [
  'src/packages/member/mip-hearts/index.wxml',
  'src/packages/member/mip-events/participants/index.wxml',
  'src/packages/member/mip-opportunity-cooperators/index.wxml',
  'src/packages/member/mip-profile-interests/index.wxml',
  'src/packages/member/mip-received/index.wxml',
  'src/pages/opportunities/index.wxml',
]

describe('MIW-85 INVITER-04 profile page stays inviter-free', () => {
  it('mip-profile 页面文件不引用 talent-card 或 inviter 字段', () => {
    const dir = path.join(root, 'src/packages/member/mip-profile')
    const files = walk(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), `${path.relative(root, file)} 不应包含 inviter/talent-card 引用`)
        .not
        .toMatch(/inviter|talent-card/i)
    }
  })

  it('六个聚合展示位的 talent-card inviter 绑定保持存在（防误删）', () => {
    for (const surface of inviterBoundSurfaces) {
      expect(readFileSync(path.join(root, surface), 'utf8'), surface).toContain('inviter-name=')
    }
  })
})
