#!/usr/bin/env node
/**
 * Per-screen conformance score (Layers 1+2 applied route by route).
 *
 * This is NOT the pixel score. It answers "which screens still drift from the
 * design system, and how much" from static facts a build can prove: token colors,
 * the type/radius scales, the page background declared in the route config, and
 * whether the screen's icons/assets resolve to the MIP registry.
 *
 * The pixel layer needs a renderer (WeChat DevTools automator, or a WXML->DOM
 * proxy in headless Chromium). See PIXEL_RENDERING.md for the decision that gates it.
 *
 *   node scripts/ui-fidelity/audit-screens.mjs [--threshold 92]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { runContractAudit } from './audit-contracts.mjs'
import { runTokenAudit } from './audit-tokens.mjs'
import { formatColor, loadPalette, nearestToken, parseColor, repoRoot } from './lib/palette.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g

function routeList() {
  const appJson = JSON.parse(fs.readFileSync(path.join(SRC, 'app.json'), 'utf8'))
  const routes = [...(appJson.pages ?? [])]
  for (const sub of appJson.subPackages ?? []) {
    for (const page of sub.pages ?? []) { routes.push(`${sub.root}/${page}`) }
  }
  return routes
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function screenFiles(route) {
  const base = path.join(SRC, route)
  return {
    wxml: readIfExists(`${base}.wxml`),
    wxss: readIfExists(`${base}.wxss`),
    json: readIfExists(`${base}.json`),
    ts: readIfExists(`${base}.ts`),
    css: readIfExists(`${base}.css`),
  }
}

function colorFindings(source, palette, allowlist, contextAllow = new Set()) {
  const out = []
  let audited = 0
  let lineNo = 0
  for (const line of source.split('\n')) {
    lineNo += 1
    COLOR_RE.lastIndex = 0
    for (const match of line.matchAll(COLOR_RE)) {
      const parsed = parseColor(match[0])
      if (!parsed) {
        continue
      }
      const rgb = formatColor(parsed)
      const triple = `${parsed.r},${parsed.g},${parsed.b}`
      // Generic scrims and explicit allowlist entries stay out of the denominator,
      // matching the Layer-1 global audit.
      if (palette.index.has(rgb) || (parsed.a < 0.999 && palette.triples.has(triple))) {
        audited += 1
      }
      else if (parsed.a < 0.999 && ['0,0,0', '255,255,255'].includes(triple)) {
        continue
      }
      else if (allowlist.has(rgb)) {
        continue
      }
      else {
        const context = line.slice(0, match.index).match(/([A-Z][A-Z0-9-]*)\s*:[^;:]*$/i)?.[1] ?? null
        if (context && contextAllow.has(context)) {
          continue
        }
        audited += 1
        out.push({ line: lineNo, rgb, context, nearest: nearestToken(parsed, palette)?.entry?.token ?? null })
      }
    }
  }
  return {
    off: out,
    audited,
  }
}

const FONT_OK = new Set([20, 22, 24, 28, 30, 32, 34, 40, 48, 96])
const RADIUS_OK = new Set([4, 8, 16, 24, 30, 32, 100, 200])
const FONT_RES = [/font-size:\s*(\d+(?:\.\d+)?)rpx/g, /text-\[(?:length:)?(\d+(?:\.\d+)?)rpx\]/g]
const RADIUS_RES = [/border-radius:\s*(\d+)rpx/g, /rounded(?:-[a-z]{1,2})*-\[(\d+)rpx\]/g]

function collect(source, regexes, ok, kind) {
  const total = []
  for (const re of regexes) {
    for (const match of source.matchAll(re)) {
      total.push(Number.parseFloat(match[1]))
    }
  }
  return { total, off: total.filter(n => !ok.has(n) && n < 200).map(value => ({ kind, value })) }
}

function geometryFindings(source) {
  return collect(source, FONT_RES, FONT_OK, 'font').off.concat(collect(source, RADIUS_RES, RADIUS_OK, 'radius').off)
}

function countGeometryFacts(source) {
  return collect(source, FONT_RES, FONT_OK, 'font').total.length + collect(source, RADIUS_RES, RADIUS_OK, 'radius').total.length
}

function readIconRegistry() {
  const file = path.join(SRC, 'components/mip-icon/icons.ts')
  const source = readIfExists(file)
  const names = new Set()
  for (const match of source.matchAll(/^\s{2}"([a-z0-9-]+)":\s*\{/gm)) {
    names.add(match[1])
  }
  return names
}

export function runScreenAudit({ threshold = 92, quiet = false } = {}) {
  const palette = loadPalette(path.join(root, 'config/mip-palette.json'))
  const allowDoc = fs.existsSync(path.join(root, 'config/ui-fidelity-allowlist.json'))
    ? JSON.parse(fs.readFileSync(path.join(root, 'config/ui-fidelity-allowlist.json'), 'utf8'))
    : {
        colors: [],
      }
  const iconRegistry = readIconRegistry()
  const routes = routeList()
  const screens = []

  for (const route of routes) {
    const files = screenFiles(route)
    const allowlist = new Set(
      (allowDoc.colors ?? []).filter(entry => entry.file === `src/${route}.ts`).map(entry => formatColor(parseColor(entry.value))),
    )
    const body = `${files.wxml}\n${files.wxss}\n${files.css}\n${files.ts}`
    const colors = colorFindings(body, palette, allowlist, new Set(allowDoc.contexts ?? []))
    const styleSource = `${files.wxml}\n${files.wxss}\n${files.css}`
    const geometry = geometryFindings(styleSource)
    const geometryFacts = countGeometryFacts(styleSource)
    const iconUsages = [...files.wxml.matchAll(/<(mip-icon|t-icon|van-icon)\b([^>]*)>/g)]
    const badIcons = iconUsages.filter(([, tag, attrs]) => {
      if (tag !== 'mip-icon') {
        return true
      }
      const name = attrs.match(/\bname="([^"{]*)"/)?.[1]
      return !name || !iconRegistry.has(name)
    })
    const config = files.json ? JSON.parse(files.json) : {}
    const pageBgOk = !config.navigationBarBackgroundColor || config.navigationBarBackgroundColor.toLowerCase() === '#080808'
    // Each dimension is its own 0-100 conformance; the screen score is their mean.
    // Averaging keeps one systemic gap (e.g. off-registry icons) from erasing the
    // dimensions a screen actually got right.
    const dimensions = {
      colors: colors.audited === 0 ? 100 : Number((((colors.audited - colors.off.length) / colors.audited) * 100).toFixed(2)),
      geometry: geometryFacts === 0 ? 100 : Number((((geometryFacts - geometry.length) / geometryFacts) * 100).toFixed(2)),
      icons: iconUsages.length === 0 ? 100 : Number((((iconUsages.length - badIcons.length) / iconUsages.length) * 100).toFixed(2)),
      pageBackground: pageBgOk ? 100 : 0,
    }
    const score = Number(((dimensions.colors + dimensions.geometry + dimensions.icons + dimensions.pageBackground) / 4).toFixed(2))
    screens.push({
      route,
      score,
      pass: score >= threshold,
      dimensions,
      offTokenColors: colors.off,
      offScaleGeometry: geometry,
      iconUsages: iconUsages.length,
      offRegistryIcons: badIcons.length,
      pageBackgroundOk: pageBgOk,
      usesCustomComponents: [...new Set([...files.wxml.matchAll(/<(app-[a-z-]+|mip-[a-z-]+|cooperation-role-card|event-card|opportunity-card|talent-card|catalog-selector)[\s/>]/g)].map(m => m[1]))],
    })
  }

  screens.sort((a, b) => a.score - b.score)
  const layers = {
    tokens: runTokenAudit({ quiet: true }),
    contracts: runContractAudit({ quiet: true }),
  }
  const passing = screens.filter(s => s.pass).length
  const report = {
    layer: 'screens',
    scoring: 'conformance',
    note: 'Static per-route conformance, not a pixel diff. See PIXEL_RENDERING.md.',
    threshold,
    screens: screens.length,
    passing,
    failing: screens.length - passing,
    screenPassRate: Number(((passing / screens.length) * 100).toFixed(2)),
    meanScore: Number((screens.reduce((sum, s) => sum + s.score, 0) / screens.length).toFixed(2)),
    layerScores: { tokens: layers.tokens.score, contracts: layers.contracts.score },
    worst: screens.slice(0, 20).map(s => ({ route: s.route, score: s.score, colors: s.offTokenColors.length, geometry: s.offScaleGeometry.length, icons: s.offRegistryIcons })),
    full: screens,
  }

  const outPath = path.join(root, '.ui-fidelity/layer-screens.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

  if (!quiet) {
    console.log(`Per-screen conformance: ${passing}/${screens.length} routes >= ${threshold}% (mean ${report.meanScore}%)`)
    console.log(`Layer 1 tokens ${report.layerScores.tokens}% | Layer 2 contracts ${report.layerScores.contracts}%`)
    for (const s of report.worst) { console.log(`  ${String(s.score).padStart(6)}%  ${s.route}  colors:${s.colors} geometry:${s.geometry} icons:${s.icons}`) }
    console.log(`  report: .ui-fidelity/layer-screens.json`)
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const idx = process.argv.indexOf('--threshold')
  const report = runScreenAudit({ threshold: idx >= 0 ? Number(process.argv[idx + 1]) : 92 })
  process.exitCode = report.failing === 0 ? 0 : 1
}
