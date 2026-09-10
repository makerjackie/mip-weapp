#!/usr/bin/env node
/**
 * Layer 1 — token baseline audit.
 *
 * Scores how completely the mini-program's literal colors, type sizes, radii and
 * theme variables resolve to the MIP design tokens, and enforces the skill's hard
 * rules. Deterministic: no browser, no fixtures, run it anywhere.
 *
 *   node scripts/ui-fidelity/audit-tokens.mjs [--json .ui-fidelity/layer1-tokens.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  formatColor,
  isYellow,
  loadPalette,
  nearestToken,
  parseColor,
  repoRoot,
} from './lib/palette.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const BASELINE = path.join(root, 'config/mip-palette.json')
const ALLOWLIST = path.join(root, 'config/ui-fidelity-allowlist.json')
const SCAN_EXTS = new Set(['.css', '.wxss', '.wxml', '.ts', '.json'])
const SKIP_DIRS = new Set(['assets', 'node_modules', 'dist', '.tmp'])
// Vendored SOT: SVG bodies are icon geometry, not app colour choices.
const SKIP_FILES = new Set(['components/mip-icon/icons.ts'])
// Pure black/white with alpha are scrim/shadow semantics, not palette choices.
const GENERIC_RGB = new Set(['rgba(0,0,0,', 'rgba(255,255,255,'])

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g
const YELLOW_RE = /#[0-9a-f]{3,8}\b/gi

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith('.')
      || (entry.isDirectory() && SKIP_DIRS.has(entry.name))
    ) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    }
    else if (
      SCAN_EXTS.has(path.extname(entry.name))
      && !SKIP_FILES.has(path.relative(SRC, full).replace(/^\.\.\//, ''))
    ) {
      out.push(full)
    }
  }
  return out
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST)) {
    return { keys: new Set(), contexts: new Set() }
  }
  const doc = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'))
  return {
    keys: new Set(
      (doc.colors ?? []).map(
        entry => `${entry.file}::${normalize(entry.value)}`,
      ),
    ),
    contexts: new Set(doc.contexts ?? []),
  }
}

function normalize(value) {
  const parsed = parseColor(value)
  return parsed ? formatColor(parsed) : String(value).toLowerCase()
}

function contextOf(line, index) {
  const before = line.slice(0, index)
  const prop = before.match(/([A-Z][A-Z0-9-]*)\s*:[^;:]*$/i)
  if (prop) {
    return prop[1]
  }
  const cls = before
    .match(/class="([^"]*)$/)?.[1]
    ?.match(/([a-z-]+)-\[[^\]]*$/)
  if (cls) {
    return `class:${cls[1]}`
  }
  const key = before.match(/"(\w+)"\s*:\s*(?:"\s*)?$/)?.[1]
  if (key) {
    return key
  }
  const tailwind = before.match(/([a-z-]+)-\[[^\]]*$/i)
  return tailwind ? `class:${tailwind[1]}` : 'value'
}

function findViolations(palette, allow) {
  const findings = []
  const files = walk(SRC)
  for (const file of files) {
    const rel = path.relative(root, file)
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (line.includes('ui-fidelity-ignore')) {
        return
      }
      COLOR_RE.lastIndex = 0
      for (const match of line.matchAll(COLOR_RE)) {
        const literal = match[0]
        const parsed = parseColor(literal)
        if (!parsed) {
          continue
        }
        const rgb = formatColor(parsed)
        const triple = `${parsed.r},${parsed.g},${parsed.b}`
        const translucent = parsed.a < 0.999
        const generic
          = translucent
            && [...GENERIC_RGB].some(prefix =>
              `rgba(${triple},`.startsWith(prefix),
            )
        const hit
          = palette.index.get(rgb)
            ?? (translucent ? palette.triples.get(triple) : null)
        const record = {
          file: rel,
          line: i + 1,
          literal,
          rgb,
          context: contextOf(line, match.index),
          token: hit?.token ?? null,
          suggestion: null,
          severity: null,
        }
        if (generic) {
          record.severity = 'generic'
          record.token = 'overlay/scrim'
        }
        else if (hit) {
          record.severity = translucent ? 'alpha' : 'ok'
        }
        else if (
          allow.keys.has(`${rel}::${rgb}`)
          || allow.contexts.has(record.context)
        ) {
          record.severity = 'allowed'
        }
        else {
          const nearest = nearestToken(parsed, palette)
          record.suggestion = nearest
            ? {
                token: nearest.entry.token,
                rgb: nearest.entry.rgb,
                distance: Number(nearest.distance.toFixed(1)),
              }
            : null
          record.severity = classifySeverity(
            rel,
            rgb,
            parsed,
            record.context,
            nearest,
          )
        }
        findings.push(record)
      }
    })
  }
  return findings
}

function classifySeverity(file, rgb, color, context, nearest) {
  if (isYellow(color) && !nearest) {
    return 'high'
  }
  const bgish = /background|bg|canvas|panel|surface|color/.test(context)
  const surfaceToken
    = rgb === '#040404'
      || rgb === '#090909'
      || rgb === '#111111'
      || rgb === '#040000'
  const isChrome = /app\.json|app\.css|brand\.ts|index\.json$/.test(file)
  if (surfaceToken && bgish) {
    return 'high'
  }
  if (isChrome && bgish) {
    return 'high'
  }
  if (nearest && nearest.distance < 40) {
    return 'medium'
  }
  return context.startsWith('class:') ? 'medium' : 'low'
}

function auditTheme(palette) {
  const appCss = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8')
  const block = appCss.match(/@theme[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const results = []
  for (const [cssVar, mapping] of Object.entries(palette.doc.themeMapping)) {
    const actual = block
      .match(new RegExp(`${cssVar}:\\s*([^;]+);`))?.[1]
      ?.trim()
    const expected = palette.colors.find(c => c.token === mapping.token)
    const actualRgb = actual ? formatColor(parseColor(actual) ?? {}) : null
    results.push({
      variable: cssVar,
      expectedToken: mapping.token,
      expected: expected?.rgb ?? null,
      actual: actualRgb,
      raw: actual ?? null,
      ok: Boolean(actualRgb && expected && actualRgb === expected.rgb),
      note: mapping.note,
    })
  }
  return results
}

function auditGeometry(palette) {
  const { fontSizesPx, radiusPx } = palette.doc.scales
  const fontOk = new Set(fontSizesPx.map(v => v * 2))
  const radiusOk = new Set(radiusPx.map(v => v * 2))
  const findings = { font: { ok: 0, off: [] }, radius: { ok: 0, off: [] } }
  for (const file of walk(SRC)) {
    const rel = path.relative(root, file)
    const text = fs.readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const [, size] of line.matchAll(
        /font-size:\s*(\d+(?:\.\d+)?)rpx/g,
      )) {
        const value = Number.parseFloat(size)
        if (fontOk.has(value)) {
          findings.font.ok += 1
        }
        else {
          findings.font.off.push({
            file: rel,
            line: i + 1,
            value,
            nearestDesignPx: Math.round(value / 2),
          })
        }
      }
      for (const [, r] of line.matchAll(
        /border-radius:\s*(\d+(?:\.\d+)?)rpx/g,
      )) {
        const value = Number.parseFloat(r)
        if (radiusOk.has(value) || value >= 200) {
          findings.radius.ok += 1
        }
        else {
          findings.radius.off.push({
            file: rel,
            line: i + 1,
            value,
            nearestDesignPx: Math.round(value / 2),
          })
        }
      }
      for (const [, r] of line.matchAll(/rounded-\[?(\d+)rpx\]?/g)) {
        const value = Number.parseFloat(r)
        if (radiusOk.has(value) || value >= 200) {
          findings.radius.ok += 1
        }
        else {
          findings.radius.off.push({
            file: rel,
            line: i + 1,
            value,
            nearestDesignPx: Math.round(value / 2),
          })
        }
      }
      for (const [, r] of line.matchAll(
        /text-\[(?:length:)?(\d+(?:\.\d+)?)rpx\]/g,
      )) {
        const value = Number.parseFloat(r)
        if (fontOk.has(value)) {
          findings.font.ok += 1
        }
        else {
          findings.font.off.push({
            file: rel,
            line: i + 1,
            value,
            nearestDesignPx: Math.round(value / 2),
          })
        }
      }
    })
  }
  return findings
}

function auditHardRules(palette) {
  const breaches = []
  const brandRgb = palette.colors.find(c => c.token === 'brand')?.rgb
  const yellows = new Set([
    '#fcdf03',
    '#fde530',
    '#ffdd02',
    '#fde104',
    '#d0b801',
    '#feeb5d',
    '#fff7b8',
    '#e3c900',
    '#72680f',
    '#3b3505',
  ])
  for (const file of walk(SRC)) {
    const rel = path.relative(root, file)
    const text = fs.readFileSync(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      YELLOW_RE.lastIndex = 0
      for (const match of line.matchAll(YELLOW_RE)) {
        const parsed = parseColor(match[0])
        if (parsed && isYellow(parsed) && !yellows.has(formatColor(parsed))) {
          breaches.push({
            rule: 'unregistered-yellow',
            file: rel,
            line: i + 1,
            value: match[0],
            expected: brandRgb,
          })
        }
      }
      if (/background-image\s*:\s*url\((?!data:)/i.test(line)) {
        breaches.push({
          rule: 'wxss-local-background-image',
          file: rel,
          line: i + 1,
          value: line.trim().slice(0, 120),
        })
      }
      if (/figma-restored\//.test(line)) {
        breaches.push({
          rule: 'upstream-runtime-path',
          file: rel,
          line: i + 1,
          value: line.trim().slice(0, 120),
        })
      }
      if (
        /^\s*import\s+(?:\S.*)?from\s+['"](?:react|react-dom|next)['"]/.test(line)
      ) {
        breaches.push({
          rule: 'react-import',
          file: rel,
          line: i + 1,
          value: line.trim().slice(0, 120),
        })
      }
    })
  }
  const appCss = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8')
  const pageBg = appCss
    .match(/page\s*\{[\s\S]*?background(?:-color)?\s*:\s*([^;\s][^;]*);/)?.[1]
    ?.trim()
  const pageBgRgb = pageBg ? formatColor(parseColor(pageBg) ?? {}) : null
  const expectedPage = palette.colors.find(c => c.token === 'bg-page')?.rgb
  if (pageBgRgb && pageBgRgb !== expectedPage) {
    breaches.push({
      rule: 'page-background',
      file: 'src/app.css',
      line: 1,
      value: pageBg,
      expected: expectedPage,
    })
  }
  return breaches
}

export function runTokenAudit({ jsonPath, quiet = false } = {}) {
  const palette = loadPalette(BASELINE)
  const allow = loadAllowlist()
  const findings = findViolations(palette, allow)
  const theme = auditTheme(palette)
  const geometry = auditGeometry(palette)
  const hardRules = auditHardRules(palette)

  const violations = findings.filter(f =>
    ['high', 'medium', 'low'].includes(f.severity),
  )
  const counted = findings.filter(
    f => !['generic', 'allowed'].includes(f.severity),
  )
  const conformant = counted.length - violations.length
  const colorScore = counted.length === 0 ? 1 : conformant / counted.length
  const themeScore = theme.filter(t => t.ok).length / theme.length
  const geoTotal
    = geometry.font.ok
      + geometry.font.off.length
      + geometry.radius.ok
      + geometry.radius.off.length
  const geometryScore
    = geoTotal === 0 ? 1 : (geometry.font.ok + geometry.radius.ok) / geoTotal
  const score = Number(
    (
      (0.6 * colorScore + 0.25 * themeScore + 0.15 * geometryScore)
      * 100
    ).toFixed(2),
  )

  const report = {
    layer: 'tokens',
    baseline: {
      file: path.relative(root, BASELINE),
      colors: palette.colors.length,
      skillSnapshot: palette.doc.skillSnapshot,
    },
    score,
    thresholds: { pass: 92 },
    pass: score >= 92 && hardRules.length === 0,
    metrics: {
      colorLiterals: findings.length,
      colorConformant: conformant,
      colorConformance: Number((colorScore * 100).toFixed(2)),
      themeVarsChecked: theme.length,
      themeConformance: Number((themeScore * 100).toFixed(2)),
      geometryChecked: geoTotal,
      geometryConformance: Number((geometryScore * 100).toFixed(2)),
      filesScanned: walk(SRC).length,
    },
    violationsBySeverity: violations.reduce(
      (acc, v) => ({ ...acc, [v.severity]: (acc[v.severity] ?? 0) + 1 }),
      {},
    ),
    topOffenders: topOffenders(violations),
    theme,
    hardRules,
    violations,
    geometry: { font: geometry.font.off, radius: geometry.radius.off },
  }

  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (!quiet) {
    console.log(
      `Layer 1 tokens: ${score}%  (color ${report.metrics.colorConformance}%, theme ${report.metrics.themeConformance}%, geometry ${report.metrics.geometryConformance}%)`,
    )
    console.log(
      `  ${violations.length} violations, ${hardRules.length} hard-rule breaches, ${report.metrics.filesScanned} files`,
    )
    for (const offender of report.topOffenders.slice(0, 12)) {
      console.log(
        `  ${offender.rgb} -> ${offender.suggestion?.token ?? '?'} x${offender.count}  ${offender.files}`,
      )
    }
    if (jsonPath) {
      console.log(`  report: ${path.relative(root, jsonPath)}`)
    }
  }
  return report
}

function topOffenders(violations) {
  const map = new Map()
  for (const v of violations) {
    const key = v.rgb
    const entry = map.get(key) ?? {
      rgb: key,
      count: 0,
      files: new Set(),
      suggestion: v.suggestion,
      severity: v.severity,
    }
    entry.count += 1
    entry.files.add(v.file)
    map.set(key, entry)
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .map(e => ({
      ...e,
      files:
        [...e.files].slice(0, 4).join(', ')
        + (e.files.size > 4 ? ` (+${e.files.size - 4})` : ''),
      fileCount: e.files.size,
    }))
}

const invokedDirectly
  = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (invokedDirectly) {
  const args = process.argv.slice(2)
  const jsonIdx = args.indexOf('--json')
  const jsonPath
    = jsonIdx >= 0
      ? path.resolve(args[jsonIdx + 1])
      : path.join(root, '.ui-fidelity/layer1-tokens.json')
  const report = runTokenAudit({ jsonPath })
  process.exitCode = report.pass ? 0 : 1
}
