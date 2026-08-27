import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('MIP level artwork presentation', () => {
  it('keeps profile level facts above the shared artwork on the brand surface', () => {
    const markup = read('src/pages/profile/index.wxml')
    const styles = read('src/pages/profile/index.wxss')

    expect(markup).toContain('class="profile-level-art"')
    expect(markup).toContain('src="/assets/figma/profile/level-art.png"')
    expect(styles).toContain('background: var(--color-brand);')
    expect(styles).toContain('mix-blend-mode: screen;')
    expect(styles).toContain('.profile-level-header,\n.profile-level-experience,\n.profile-level-progress,\n.profile-level-loading')
    expect(styles).toContain('z-index: 1;')
  })

  it('reuses the artwork with screen blending on the growth brand hero', () => {
    const markup = read('src/packages/member/mip-growth/index.wxml')
    const styles = read('src/packages/member/mip-growth/index.wxss')

    expect(markup).toContain('class="growth-level-art ')
    expect(markup).toContain('src="/assets/figma/profile/level-art.png"')
    expect(markup).toContain('bg-brand px-5 py-6 text-on-brand')
    expect(markup).toContain('relative z-10')
    expect(styles).toContain('.growth-level-art {\n  mix-blend-mode: screen;\n}')
  })
})
