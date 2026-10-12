import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// BUG-01（交互审计 2026-10-12）：triggerEvent('tap') 与原生冒泡 tap 同名，
// 一次点按会让宿主 handler 执行两次。三类修复各有守卫断言：
// 1) 无包装用法的组件根节点改 catch:tap（同 mip-pill-button 的 F1 修复）；
// 2) 有包装用法依赖冒泡的组件保持 bind:tap，自定义事件改非原生名 select；
// 3) 页面在组件标签上只绑定非原生事件名。
describe('component tap single-fire contract', () => {
  it('uses catch:tap on self-contained row/card components so the host binding fires once', () => {
    for (const component of ['mip-detail-row', 'mip-form-field-row', 'mip-order-card']) {
      const template = read(`src/components/${component}/index.wxml`)
      expect(template, component).toContain('catch:tap="handleTap"')
      expect(template, component).not.toContain('bind:tap="handleTap"')
    }
  })

  it('keeps bind:tap for wrapper-supported chips but emits a non-native event name', () => {
    for (const component of ['mip-tag-chip', 'mip-attend-pill']) {
      const template = read(`src/components/${component}/index.wxml`)
      const script = read(`src/components/${component}/index.ts`)
      // 外层容器依赖原生冒泡接住点击，根节点必须继续放行冒泡。
      expect(template, component).toContain('bind:tap="handleTap"')
      expect(script, component).toContain('triggerEvent(\'select\'')
      expect(script, component).not.toContain('triggerEvent(\'tap\'')
    }
  })

  it('binds the renamed select event at the direct chip consumer', () => {
    const template = read('src/packages/member/mip-cases/editor/index.wxml')
    expect(template).toContain('bind:select="applyHotCity"')
    expect(template).not.toContain('bind:tap="applyHotCity"')
  })

  it('still wraps chips with view-level taps in the industry selector (no direct chip tap bindings)', () => {
    const template = read('src/components/mip-industry-selector/index.wxml')
    expect(template.match(/<mip-tag-chip[^>]*bind:tap/g) ?? []).toEqual([])
    expect(template.match(/<mip-tag-chip[^>]*bind:select/g) ?? []).toEqual([])
  })
})
