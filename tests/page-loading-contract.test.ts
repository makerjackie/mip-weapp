import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const app = JSON.parse(fs.readFileSync(path.join(root, 'src/app.json'), 'utf8'))
const routes: string[] = [...app.pages, ...app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => pkg.pages.map(route => `${pkg.root}/${route}`))]
function read(route: string, extension: string) {
  return fs.readFileSync(path.join(root, `src/${route}.${extension}`), 'utf8')
}

describe('all registered page loading contracts', () => {
  it.each(routes)('%s keeps an explicit native loading background and reachable error actions', (route) => {
    const config = { ...app.window, ...JSON.parse(read(route, 'json')) }
    for (const name of ['backgroundColor', 'backgroundColorContent']) {
      const expected = route === 'packages/member/mip-growth/index' && name === 'backgroundColor'
        ? '#FCDF03'
        : undefined
      if (expected) {
        expect(config[name], `${route}: ${name}`).toBe(expected)
      }
      else {
        expect(config[name], `${route}: ${name}`).toMatch(/^#(?:080808|040404)$/)
      }
    }
    const source = read(route, 'ts')
    const ast = ts.createSourceFile(`${route}.ts`, source, ts.ScriptTarget.Latest, true)
    const methods = new Set<string>()
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'Page') {
        const definition = node.arguments[0]
        if (definition && ts.isObjectLiteralExpression(definition)) {
          for (const property of definition.properties) {
            if (property.name) {
              methods.add(property.name.getText(ast))
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    for (const [tag] of read(route, 'wxml').matchAll(/<mip-empty-state\b[^>]*>/g)) {
      const action = tag.match(/bind:action="([^"]+)"/)?.[1]
      if (action) {
        expect(methods.has(action), `${route}: missing ${action}`).toBe(true)
      }
    }
  })
  it('provides dark skeleton defaults centrally, before any individual page overrides', () => {
    const css = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8')
    expect(css).toContain('--td-skeleton-bg-color: #242424;')
    expect(css).toContain('--td-skeleton-animation-gradient: rgb(255 255 255 / 8%);')
  })
})
