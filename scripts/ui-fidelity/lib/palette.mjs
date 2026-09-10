/**
 * MIP palette loader.
 *
 * The Layer-1 baseline is generated from the mip-design-system skill
 * (`assets/wechat/tokens.wxss`) plus the documented deltas in `references/DESIGN.md`
 * and `references/wechat-component-contracts.md`, then vendored to
 * `config/mip-palette.json` so CI does not depend on a gitignored skill checkout.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Color literal -> { token, group, note } entries that DESIGN.md registers but tokens.wxss omits. */
export const DOCUMENTED_EXTENSIONS = [
  {
    token: 'brand-bright-2',
    value: '#fde530',
    group: 'brand',
    note: 'DESIGN.md §9.1 活动/机会高亮黄',
  },
  {
    token: 'brand-dark-stroke',
    value: '#d0b801',
    group: 'brand',
    note: 'DESIGN.md §2.2 黄色图形描边',
  },
  {
    token: 'accent-red',
    value: '#ff2248',
    group: 'status',
    note: 'DESIGN.md §9.1 嘉宾-c 插画红',
  },
  {
    token: 'text-dim-2',
    value: '#4c4c4c',
    group: 'text',
    note: 'DESIGN.md §9.1 日历非本月数字',
  },
  {
    token: 'ios-gray',
    value: '#8e8e93',
    group: 'text',
    note: 'DESIGN.md §9.1 iOS systemGray 语义',
  },
  {
    token: 'illus-navy',
    value: '#09121f',
    group: 'illustration',
    note: 'DESIGN.md §9.1 机会探索深色矢量',
  },
  {
    token: 'illus-skin',
    value: '#ffd3a7',
    group: 'illustration',
    note: 'DESIGN.md §9.1 插画肤色',
  },
  {
    token: 'illus-stroke-light',
    value: '#eeeeee',
    group: 'illustration',
    note: 'DESIGN.md §9.1 浅色矢量描边',
  },
  {
    token: 'record-pulse-outer',
    value: '#fff7b8',
    group: 'brand',
    note: 'DESIGN.md §2.8 录音光晕外圈',
  },
  {
    token: 'record-pulse-inner',
    value: '#feeb5d',
    group: 'brand',
    note: 'DESIGN.md §2.8 录音光晕内圈',
  },
  {
    token: 'coop-name-upstart',
    value: '#fadab3',
    group: 'illustration',
    note: 'contracts CooperationCard upstart 名色',
  },
  {
    token: 'coop-name-design-slave',
    value: '#e5fff1',
    group: 'illustration',
    note: 'contracts CooperationCard design-slave 名色',
  },
  {
    token: 'coop-name-pimp',
    value: '#ffe5f9',
    group: 'illustration',
    note: 'contracts CooperationCard pimp 名色',
  },
  {
    token: 'coop-name-business-man',
    value: '#ffeee5',
    group: 'illustration',
    note: 'contracts CooperationCard business-man 名色',
  },
  {
    token: 'coop-name-old-nanny',
    value: '#e5efff',
    group: 'illustration',
    note: 'contracts CooperationCard old-nanny 名色',
  },
  {
    token: 'coop-bg-pimp',
    value: '#df07a9',
    group: 'illustration',
    note: 'contracts CooperationCard pimp 垫底',
  },
  {
    token: 'illus-5-blue',
    value: '#1a71ff',
    group: 'illustration',
    note: 'DESIGN.md §2.4 合作卡插画五色',
  },
  {
    token: 'illus-5-green',
    value: '#04a44f',
    group: 'illustration',
    note: 'DESIGN.md §2.4 合作卡插画五色',
  },
  {
    token: 'illus-5-orange',
    value: '#ff5500',
    group: 'illustration',
    note: 'DESIGN.md §2.4 合作卡插画五色',
  },
  {
    token: 'illus-5-magenta',
    value: '#af0484',
    group: 'illustration',
    note: 'DESIGN.md §2.4 合作卡插画五色',
  },
  {
    token: 'illus-5-brown',
    value: '#7a2900',
    group: 'illustration',
    note: 'DESIGN.md §2.4 合作卡插画五色',
  },
  {
    token: 'star-off',
    value: '#4d4d4d',
    group: 'control',
    note: 'contracts StarRating 空星',
  },
  {
    token: 'progress-slot',
    value: '#4d4400',
    group: 'control',
    note: 'contracts LevelBanner 进度槽',
  },
  {
    token: 'switch-off',
    value: '#39393d',
    group: 'control',
    note: 'contracts Switch 关闭底',
  },
  {
    token: 'order-tag-salon-bg',
    value: '#428bff',
    group: 'status',
    note: 'contracts OrderTag 沙龙预设底',
  },
  {
    token: 'order-tag-salon-border',
    value: '#075adf',
    group: 'status',
    note: 'contracts OrderTag 沙龙预设描边',
  },
  {
    token: 'glass-scrim',
    value: 'rgba(20,20,20,0.45)',
    group: 'overlay',
    note: 'DESIGN.md §2.7 GLASS 近似底',
  },
]

/** Registered yellows — any other yellow is a hard-rule violation. */
export const REGISTERED_YELLOWS = [
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
]

/** Design-px scales derived from DESIGN.md §3/§4. Runtime converts px -> rpx at 1px = 2rpx. */
export const DESIGN_SCALES = {
  fontSizesPx: [10, 11, 12, 14, 15, 16, 17, 20, 24, 48],
  lineHeightsPx: [
    13,
    14,
    16.8,
    17,
    19.6,
    20,
    22,
    22.4,
    28,
    48,
    57,
    40,
    34,
    44,
    33,
    28,
  ],
  fontWeights: [400, 500, 600, 700],
  radiusPx: [2, 4, 8, 12, 15, 16, 50, 100],
  spacingPx: [
    1,
    2,
    4,
    8,
    10,
    12,
    16,
    20,
    24,
    28,
    32,
    34,
    40,
    46,
    47,
    56,
    64,
    72,
    80,
    88,
    92,
    100,
    112,
    120,
    128,
    149,
    160,
    176,
    200,
    232,
    238,
    256,
    320,
    351,
    375,
    400,
    500,
    700,
    1000,
    2000,
  ],
}

/** Semantic name the repo's Tailwind theme must resolve to. Checked against src/app.css @theme. */
export const THEME_MAPPING = {
  '--color-canvas': { token: 'bg-page', note: '页面底色' },
  '--color-panel': { token: 'bg-surface', note: '卡片/行底' },
  '--color-panel-raised': {
    token: 'bg-surface-3',
    note: '次级卡（设计稿为 #242424）',
  },
  '--color-panel-muted': { token: 'bg-surface-3', note: '次级卡' },
  '--color-ink': { token: 'text-primary', note: '主文案' },
  '--color-muted': { token: 'text-secondary', note: '次要文案' },
  '--color-line': {
    token: 'bg-surface-2',
    note: '分隔/描边（设计稿 #333333）',
  },
  '--color-brand': { token: 'brand', note: '品牌黄' },
  '--color-on-brand': { token: 'text-on-brand', note: '黄底文字' },
  '--color-danger': { token: 'danger', note: '危险色（设计稿 #ff4d5e）' },
  '--color-success': { token: 'success', note: '成功色（设计稿 #18e779）' },
}

export function parseColor(input) {
  const raw = String(input).trim()
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i)
  if (hex && [3, 4, 6, 8].includes(hex[1].length)) {
    let h = hex[1].toLowerCase()
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map(c => c + c)
        .join('')
    }
    const r = Number.parseInt(h.slice(0, 2), 16)
    const g = Number.parseInt(h.slice(2, 4), 16)
    const b = Number.parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1
    return {
      r,
      g,
      b,
      a,
    }
  }
  const fn
    = raw.match(/^rgba?\(([^)]+)\)$/i) || raw.match(/^hsla?\(([^)]+)\)$/i)
  if (!fn) {
    return null
  }
  const parts = fn[1]
    .replace(/,/g, ' ')
    .split(/[\s/]+/)
    .filter(Boolean)
  if (/^hsla?\(/i.test(raw)) {
    const [h, s, l] = parts
    const hue = Number.parseFloat(h)
    const sat = Number.parseFloat(s) / 100
    const lig = Number.parseFloat(l) / 100
    const alpha = parts[3] ? parseAlpha(parts[3]) : 1
    return {
      ...hslToRgb(hue, sat, lig),
      a: alpha,
    }
  }
  const [r, g, b] = parts
  if ([r, g, b].includes(undefined)) {
    return null
  }
  const channels = [r, g, b].map(v => Number.parseInt(v, 10))
  const alpha = parts[3] ? parseAlpha(parts[3]) : 1
  // Anything that is not a literal (var(), env(), calc()) is not a palette decision.
  if (channels.some(v => !Number.isFinite(v)) || !Number.isFinite(alpha)) {
    return null
  }
  return {
    r: channels[0],
    g: channels[1],
    b: channels[2],
    a: alpha,
  }
}

function parseAlpha(token) {
  const value = String(token).trim()
  if (value.endsWith('%')) {
    return Number.parseFloat(value) / 100
  }
  return Number.parseFloat(value)
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b]
    = h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

export function formatColor({ r, g, b, a = 1 }) {
  if (a >= 0.999) {
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
  }
  return `rgba(${r},${g},${b},${Number(a.toFixed(2))})`
}

export function colorDistance(a, b) {
  // Perceptual weighting: human contrast is green-dominant, blue least sensitive.
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db)
}

export function hueOf(color) {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) {
    return 0
  }
  const d = max - min
  const l = (max + min) / 2
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  }
  else if (max === g) {
    h = ((b - r) / d + 2) * 60
  }
  else {
    h = ((r - g) / d + 4) * 60
  }
  return {
    h,
    s,
    l,
  }
}

export function isYellow(color) {
  const hsl = hueOf(color)
  if (!hsl || typeof hsl !== 'object') {
    return false
  }
  return hsl.h >= 40 && hsl.h <= 72 && hsl.s >= 0.45 && hsl.l >= 0.3
}

/** Palette derived from tokens.wxss text, merged with the curated DESIGN.md deltas. */
export function buildPaletteFromTokensWxss(tokensSource) {
  const colors = []
  const seen = new Set()
  const declRe = /--mip-([a-z0-9-]+)\s*:\s*([^;\s][^;]*);/g
  for (const match of tokensSource.matchAll(declRe)) {
    const [, name, value] = match
    const parsed = parseColor(value)
    if (!parsed) {
      continue
    }
    const token = name
    if (seen.has(token)) {
      continue
    }
    seen.add(token)
    colors.push({
      token,
      value: value.trim(),
      rgb: formatColor(parsed),
      alpha: parsed.a,
      group: groupOf(name),
    })
  }
  for (const extra of DOCUMENTED_EXTENSIONS) {
    const parsed = parseColor(extra.value)
    if (!parsed) {
      continue
    }
    if (seen.has(extra.token)) {
      continue
    }
    seen.add(extra.token)
    colors.push({
      token: extra.token,
      value: extra.value,
      rgb: formatColor(parsed),
      alpha: parsed.a,
      group: extra.group,
      note: extra.note,
    })
  }
  return colors
}

function groupOf(name) {
  if (name.startsWith('bg-')) {
    return 'surface'
  }
  if (name.startsWith('text-')) {
    return 'text'
  }
  if (name.startsWith('brand')) {
    return 'brand'
  }
  if (name.startsWith('purple')) {
    return 'illustration'
  }
  if (name === 'record' || name === 'success' || name === 'danger') {
    return 'status'
  }
  if (name.startsWith('overlay') || name === 'hairline') {
    return 'overlay'
  }
  return 'other'
}

export function loadPalette(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  const index = new Map()
  const triples = new Map()
  for (const color of doc.colors) {
    index.set(color.rgb, color)
    const parsed = parseColor(color.rgb)
    if (!parsed || parsed.a < 0.999) {
      continue
    }
    const key = `${parsed.r},${parsed.g},${parsed.b}`
    if (!triples.has(key)) {
      triples.set(key, color)
    }
  }
  return {
    doc,
    index,
    triples,
    colors: doc.colors,
  }
}

export function nearestToken(color, palette) {
  let best = null
  for (const entry of palette.colors) {
    const parsed = parseColor(entry.rgb)
    if (!parsed) {
      continue
    }
    const distance = colorDistance(color, parsed)
    if (!best || distance < best.distance) {
      best = { entry, distance }
    }
  }
  return best
}

export function repoRoot(start) {
  let dir = path.dirname(start)
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  throw new Error(`repo root not found from ${start}`)
}
