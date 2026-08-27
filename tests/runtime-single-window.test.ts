import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { selectRuntimeDevtoolsRoot } from '../scripts/lib/devtools-host.mjs'

describe('runtime DevTools project selection', () => {
  const sourceRoot = path.resolve('/workspace/mip-weapp')
  const hostRoot = path.resolve('/cache/mip-weapp-runtime')

  it('reuses the open source project automator instead of opening a second project', () => {
    expect(selectRuntimeDevtoolsRoot({
      sourceRoot,
      hostRoot,
      openedSourceAutomatorAvailable: true,
    })).toBe(sourceRoot)
  })

  it('keeps the isolated host fallback when the source project is not open', () => {
    expect(selectRuntimeDevtoolsRoot({
      sourceRoot,
      hostRoot,
      openedSourceAutomatorAvailable: false,
    })).toBe(hostRoot)
  })
})
