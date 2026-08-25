import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const sharePages = [
  'src/pages/events/index',
  'src/packages/member/mip-card/index',
  'src/packages/member/mip-events/detail/index',
  'src/packages/member/mip-events/participants/index',
  'src/packages/member/mip-opportunities/detail/index',
  'src/packages/member/mip-cases/detail/index',
  'src/packages/member/event-detail/index',
]

function collectJsonFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectJsonFiles(absolutePath)
    }
    return entry.isFile() && entry.name.endsWith('.json') ? [absolutePath] : []
  })
}

describe('WeChat page share configuration', () => {
  it('does not use the unsupported enableShareAppMessage page setting', () => {
    const pageConfigFiles = [
      ...collectJsonFiles(path.join(root, 'src/pages')),
      ...collectJsonFiles(path.join(root, 'src/packages')),
    ]

    for (const file of pageConfigFiles) {
      const config = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
      expect(config, path.relative(root, file)).not.toHaveProperty('enableShareAppMessage')
    }
  })

  it('keeps share handlers on every shareable page', () => {
    for (const page of sharePages) {
      const controller = fs.readFileSync(path.join(root, `${page}.ts`), 'utf8')
      expect(controller, page).toMatch(/\bonShareAppMessage\s*\(/)
    }
  })

  it('retains timeline sharing where it is explicitly enabled', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(root, 'src/packages/member/event-detail/index.json'), 'utf8'),
    ) as { enableShareTimeline?: boolean }

    expect(config.enableShareTimeline).toBe(true)
  })
})
