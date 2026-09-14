#!/usr/bin/env node
/**
 * Layer 2 — component contract audit.
 *
 * Checks the mini-program against references/wechat-component-contracts.md:
 * mip-icon registry names, baked asset paths, CooperationCard's six variants,
 * LevelBanner's baked-card rules, and which contracted components exist.
 *
 *   node scripts/ui-fidelity/audit-contracts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { repoRoot } from './lib/palette.mjs'

const root = repoRoot(import.meta.dirname)
const SRC = path.join(root, 'src')
const ICON_REGISTRY = path.join(SRC, 'components/mip-icon/icons.ts')
const ASSET_DIR = path.join(SRC, 'assets/mip')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.tmp'])

// references/wechat-component-contracts.md — CooperationCard baked variants.
const COOPERATION_VARIANTS = {
  'dogplaner': {
    image: 'coop-card-dogplaner@3x.png',
    bg: '#7b00ff',
    name: '#f2e5ff',
  },
  'upstart': {
    image: 'coop-card-upstart@3x.png',
    bg: '#7a2900',
    name: '#fadab3',
  },
  'design-slave': {
    image: 'coop-card-design-slave@3x.png',
    bg: '#04a44f',
    name: '#e5fff1',
  },
  'pimp': { image: 'coop-card-pimp@3x.png', bg: '#df07a9', name: '#ffe5f9' },
  'business-man': {
    image: 'coop-card-business-man@3x.png',
    bg: '#ff5500',
    name: '#ffeee5',
  },
  'old-nanny': {
    image: 'coop-card-old-nanny@3x.png',
    bg: '#1a71ff',
    name: '#e5efff',
  },
}

// Contracted components required by the MIP Design System. The migration gate is
// directional while SOT icon gaps remain explicitly allowlisted.
const REQUIRED_COMPONENTS = [
  'mip-icon',
  'mip-nav-bar',
  'mip-tab-bar',
  'mip-detail-row',
  'mip-tag-chip',
  'mip-primary-button',
  'mip-pill-button',
  'mip-level-banner',
  'mip-cooperation-card',
  'mip-activity-card',
  'mip-opportunity-card',
  'mip-order-card',
  'mip-attend-pill',
  'mip-stat-header',
  'mip-empty-state',
  'mip-dialog',
  'mip-section-header',
  'mip-search-bar',
]

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out
  }
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
    else {
      out.push(full)
    }
  }
  return out
}

function readIconNames() {
  if (!fs.existsSync(ICON_REGISTRY)) {
    return null
  }
  const source = fs.readFileSync(ICON_REGISTRY, 'utf8')
  const names = new Set()
  for (const match of source.matchAll(/^\s{2}['"]([a-z0-9-]+)['"]:\s*\{/gm)) {
    names.add(match[1])
  }
  return names
}

function auditIcons(files, registry) {
  const usages = []
  for (const file of files.filter(f => f.endsWith('.wxml'))) {
    const rel = path.relative(root, file)
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(
      /<(mip-icon|t-icon|van-icon)([^>]*)>/g,
    )) {
      const [tag, attrs] = [match[1], match[2]]
      const name = attrs.match(/\bname="([^"{]*)"/)?.[1] ?? null
      const dynamic = /\bname="\{\{/.test(attrs)
      usages.push({
        file: rel,
        line: source.slice(0, match.index).split('\n').length,
        tag,
        name,
        dynamic,
        // A dynamic mip-icon name is validated by the component at runtime; a
        // dynamic foreign icon remains a contract deviation because the design
        // system is not necessarily loaded.
        ok:
          tag === 'mip-icon'
          && (Boolean(dynamic) || Boolean(name && registry?.has(name))),
      })
    }
  }
  const mip = usages.filter(u => u.tag === 'mip-icon')
  const foreign = usages.filter(u => u.tag !== 'mip-icon')
  const unknown = mip.filter(u => u.name && !registry?.has(u.name))
  return {
    usages,
    total: usages.length,
    mipTotal: mip.length,
    mipValid: mip.filter(u => u.ok).length,
    foreignTotal: foreign.length,
    unknown,
    dynamicNames: usages.filter(u => u.dynamic).length,
    foreignByTag: foreign.reduce(
      (acc, u) => ({ ...acc, [u.tag]: (acc[u.tag] ?? 0) + 1 }),
      {},
    ),
    score:
      usages.length === 0 ? 1 : mip.filter(u => u.ok).length / usages.length,
  }
}

function auditBakedAssets(files) {
  const refs = []
  for (const file of files) {
    if (!/\.(?:wxml|wxss|ts|json)$/.test(file)) {
      continue
    }
    const rel = path.relative(root, file)
    const source = fs.readFileSync(file, 'utf8')
    source.split('\n').forEach((line, i) => {
      for (const match of line.matchAll(/\/assets\/mip\/([\w@.-]+)/g)) {
        refs.push({
          file: rel,
          line: i + 1,
          name: match[1],
          exists: fs.existsSync(path.join(ASSET_DIR, match[1])),
        })
      }
    })
  }
  const onDisk = fs.existsSync(ASSET_DIR) ? fs.readdirSync(ASSET_DIR) : []
  const referenced = new Set(refs.map(r => r.name))
  return {
    refs,
    missing: refs.filter(r => !r.exists),
    unused: onDisk.filter(name => !referenced.has(name)),
    onDisk,
    score:
      refs.length === 0 ? 0 : refs.filter(r => r.exists).length / refs.length,
  }
}

function auditCooperationCard() {
  const dir = path.join(SRC, 'components/mip-cooperation-card')
  const checks = []
  const push = (name, ok, detail) => checks.push({ name, ok, detail })
  const modelFile = path.join(dir, 'model.ts')
  const componentWxml = path.join(dir, 'index.wxml')
  const model = fs.existsSync(modelFile)
    ? fs.readFileSync(modelFile, 'utf8')
    : ''
  const wxml = fs.existsSync(componentWxml)
    ? fs.readFileSync(componentWxml, 'utf8')
    : ''

  push('component exists', Boolean(model && wxml), path.relative(root, dir))
  const variantNames = Object.keys(COOPERATION_VARIANTS)
  const declared = new Set(
    [...model.matchAll(/'([a-z-]+)':\s*\{\s*image:/g)].map(m => m[1]),
  )
  push(
    'declares exactly the six documented variants',
    variantNames.every(v => declared.has(v)) && declared.size === 6,
    [...declared].join(', ') || 'no variant map found',
  )
  for (const [variant, spec] of Object.entries(COOPERATION_VARIANTS)) {
    const block
      = model.match(new RegExp(`'${variant}':\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
    push(
      `${variant} uses ${spec.image}`,
      block.includes(spec.image),
      block.trim().slice(0, 80) || 'missing',
    )
    push(
      `${variant} fallback bg ${spec.bg}`,
      new RegExp(spec.bg, 'i').test(block),
      block.trim().slice(0, 80) || 'missing',
    )
  }
  push(
    'baked asset is an <image>, not a WXSS background',
    /<image[^>]*assets\/mip/.test(wxml) || /assets\/mip/.test(model),
    'no <image> binding found',
  )
  push(
    'card clips its baked image',
    /\.mip-clip|overflow:\s*hidden/.test(
      fs.existsSync(path.join(dir, 'index.wxss'))
        ? fs.readFileSync(path.join(dir, 'index.wxss'), 'utf8')
        : '',
    ),
    'overflow hidden missing',
  )
  push(
    'no text baked into reusable asset',
    // match(/image:/g) returns an array, so testing it directly always passed; inspect the lines.
    !(model.match(/image:[^\n]*/g) ?? []).some(line => /roleName|positioning/.test(line)),
    '',
  )
  return checks
}

function auditLevelBanner() {
  const files = walk(path.join(SRC, 'components')).filter(f =>
    /level-banner|levelBanner/i.test(f),
  )
  const checks = []
  const push = (name, ok, detail) => checks.push({ name, ok, detail })
  const found = files.length > 0
  push(
    'LevelBanner component exists',
    found,
    found ? path.relative(root, files[0]) : 'not vendored yet',
  )
  if (!found) {
    return checks
  }
  const wxml = files.find(f => f.endsWith('.wxml'))
  const source = wxml ? fs.readFileSync(wxml, 'utf8') : ''
  push(
    'uses level-banner-deco@3x.png',
    source.includes('level-banner-deco@3x.png'),
    '',
  )
  push(
    'has no decoration prop or child deco layer',
    !/deco=|decoration/.test(source),
    '',
  )
  push(
    'declares 702x160rpx footprint',
    /702rpx/.test(source)
    || (fs.existsSync(path.join(path.dirname(wxml), 'index.wxss'))
      && fs
        .readFileSync(path.join(path.dirname(wxml), 'index.wxss'), 'utf8')
        .includes('702rpx')),
    '',
  )
  return checks
}

function auditRegistration() {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(SRC, 'app.json'), 'utf8'),
  )
  const globalComponents = Object.keys(appJson.usingComponents ?? {})
  return {
    globalComponents,
    mipIconRegistered: globalComponents.some(name =>
      name.includes('mip-icon'),
    ),
  }
}

function auditCoverage() {
  const present = new Set(
    fs.existsSync(path.join(SRC, 'components'))
      ? fs.readdirSync(path.join(SRC, 'components'))
      : [],
  )
  const customTabBar = fs.existsSync(path.join(SRC, 'custom-tab-bar'))
    ? ['mip-tab-bar']
    : []
  const implemented = new Set(
    [...present, ...customTabBar].map(name =>
      name.replace(/^app-/, '').replace(/-/g, '-'),
    ),
  )
  const missing = REQUIRED_COMPONENTS.filter(
    name => !implemented.has(name) && !present.has(name),
  )
  return {
    required: REQUIRED_COMPONENTS.length,
    missing,
    implemented: REQUIRED_COMPONENTS.length - missing.length,
  }
}

function loadIconExceptions() {
  const file = path.join(root, 'config/ui-fidelity-allowlist.json')
  const doc = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : {}
  const exceptions = new Set()
  for (const group of doc.foreignIcons ?? []) {
    for (const name of group.names ?? []) {
      exceptions.add(`name:${name}`)
    }
    if (group.dynamic) {
      exceptions.add('dynamic')
    }
  }
  return exceptions
}

export function runContractAudit({ jsonPath, quiet = false } = {}) {
  const files = walk(SRC)
  const registry = readIconNames()
  const icons = auditIcons(files, registry)
  const assets = auditBakedAssets(files)
  const cooperation = auditCooperationCard()
  const levelBanner = auditLevelBanner()
  const registration = auditRegistration()
  const coverage = auditCoverage()
  const iconExceptions = loadIconExceptions()
  const allowedIcons = icons.usages.filter(
    u =>
      !u.ok
      && ((u.dynamic && iconExceptions.has('dynamic'))
        || (!u.dynamic && u.name && iconExceptions.has(`name:${u.name}`))),
  )
  const scoredIcons = icons.total - allowedIcons.length
  const iconScore = scoredIcons === 0 ? 1 : icons.mipValid / scoredIcons

  const contractChecks = [...cooperation, ...levelBanner]
  const contractScore
    = contractChecks.length === 0
      ? 0
      : contractChecks.filter(c => c.ok).length / contractChecks.length
  const scores = {
    icons: Number((iconScore * 100).toFixed(2)),
    bakedAssets: Number((assets.score * 100).toFixed(2)),
    componentContracts: Number((contractScore * 100).toFixed(2)),
  }
  const score = Number(
    (
      (scores.icons + scores.bakedAssets + scores.componentContracts)
      / 3
    ).toFixed(2),
  )

  const report = {
    layer: 'contracts',
    score,
    thresholds: { pass: 92, coverage: 70 },
    pass:
      score >= 92
      && (coverage.implemented / coverage.required) * 100 >= 70,
    metrics: scores,
    registry: { icons: registry?.size ?? 0, loaded: Boolean(registry) },
    registration,
    coverage: {
      ...coverage,
      coveragePercent: Number(
        ((coverage.implemented / coverage.required) * 100).toFixed(1),
      ),
    },
    icons: {
      total: icons.total,
      scoredTotal: scoredIcons,
      mipTotal: icons.mipTotal,
      mipValid: icons.mipValid,
      allowedForeign: {
        total: allowedIcons.length,
        static: allowedIcons.filter(u => !u.dynamic).length,
        dynamic: allowedIcons.filter(u => u.dynamic).length,
      },
      foreignTotal: icons.foreignTotal,
      foreignByTag: icons.foreignByTag,
      dynamicNames: icons.dynamicNames,
      unknown: icons.unknown,
      foreignSamples: icons.usages.filter(u => !u.ok).slice(0, 40),
    },
    assets: {
      referenced: assets.refs.length,
      missing: assets.missing,
      unused: assets.unused,
      onDisk: assets.onDisk,
    },
    checks: contractChecks,
  }

  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (!quiet) {
    console.log(
      `Layer 2 contracts: ${score}%  (icons ${scores.icons}%, baked ${scores.bakedAssets}%, contracts ${scores.componentContracts}%)`,
    )
    console.log(
      `  ${icons.mipValid}/${icons.total} icon usages are registry-valid mip-icon; ${icons.foreignTotal} foreign (${Object.entries(
        icons.foreignByTag,
      )
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')})`,
    )
    console.log(
      `  baked assets: ${assets.refs.length} refs, ${assets.missing.length} missing, ${assets.unused.length} unused; component coverage ${coverage.implemented}/${coverage.required}`,
    )
    for (const check of contractChecks.filter(c => !c.ok)) {
      console.log(
        `  FAIL ${check.name}${check.detail ? ` — ${check.detail}` : ''}`,
      )
    }
    if (jsonPath) {
      console.log(`  report: ${path.relative(root, jsonPath)}`)
    }
  }
  return report
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
      : path.join(root, '.ui-fidelity/layer2-contracts.json')
  const report = runContractAudit({ jsonPath })
  process.exitCode = report.pass ? 0 : 1
}
