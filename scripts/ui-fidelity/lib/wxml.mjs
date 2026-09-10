/**
 * Minimal WXML -> HTML renderer for pixel fidelity scoring.
 *
 * Deliberately a *proxy*, not a mini-program runtime: it covers the syntax this
 * repo actually uses (view/text/image/block/scroll-view/input/button/textarea,
 * wx:if/elif/else, wx:for with item/index/key, {{interp}} expressions, custom
 * components with recursive inlining and per-instance style scoping, slots).
 * It does not run page JS or component lifecycles — screens are rendered from an
 * explicit fixture instead, so the pixels compared are the template plus the data.
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const TAG_MAP = {
  'view': 'div',
  'text': 'span',
  'image': 'img',
  'scroll-view': 'div',
  'block': '',
  'button': 'button',
  'input': 'input',
  'textarea': 'textarea',
  'navigator': 'a',
  'picker': 'div',
  'picker-view': 'div',
  'swiper': 'div',
  'swiper-item': 'div',
  'canvas': 'div',
  'cover-view': 'div',
  'rich-text': 'div',
  'web-view': 'div',
  'slot': '',
  'wxs': '',
  'mip-icon': 'span',
}

const OBJECT_FIT = {
  aspectFill: 'cover',
  aspectFit: 'contain',
  widthFix: 'contain',
  scaleToFill: 'fill',
}
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr'])

const exprCache = new Map()
// Missing data keys read as undefined instead of throwing, so a partial fixture
// renders the same branches the page renders before that field resolves.
function withFallback(scope) {
  return new Proxy(scope, {
    has: () => true,
    get: (target, key) =>
      key === Symbol.unscopables ? undefined : target[key],
  })
}

function evalExpr(expr, scope) {
  if (!exprCache.has(expr)) {
    try {
      exprCache.set(
        expr,
        new vm.Script(`(${expr})`),
      )
    }
    catch {
      exprCache.set(expr, () => undefined)
    }
  }
  try {
    return exprCache
      .get(expr)
      .runInNewContext(withFallback(scope ?? {}))
  }
  catch {
    return undefined
  }
}

function interpolate(value, scope) {
  if (value == null) {
    return ''
  }
  const whole = /^\{\{([\s\S]*)\}\}$/.exec(String(value).trim())
  // Only a single interpolation may take the fast path: "{{a}} I {{b}}" must go
  // through the replacement loop, or the middle is parsed as one broken expression.
  if (whole && !/\}\}|\{\{/.test(whole[1])) {
    return evalExpr(whole[1], scope)
  }
  return String(value).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const out = evalExpr(expr, scope)
    return out === undefined || out === null ? '' : String(out)
  })
}

function truthy(value, scope) {
  if (typeof value === 'string') {
    const t = value.trim().replace(/^\{\{([\s\S]*)\}\}$/, '$1')
    if (!t) {
      return false
    }
    return Boolean(evalExpr(t, scope))
  }
  return Boolean(value)
}

/** Tokenizer: comments, self-closing, open/close, text runs, attributes preserved. */
/* eslint-disable regexp/no-super-linear-backtracking -- Repository-owned WXML; the alternatives intentionally keep quoted values atomic. */
export function parseWxml(source) {
  const root = { children: [] }
  const stack = [root]
  // Attribute values are matched as whole quoted strings so `>` and `<` inside
  // interpolations (e.g. style="width: {{a > b ? x : y}}rpx") don't end the tag.
  const tagRe
    = /<!--[\s\S]*?-->|<\/([a-z][\w:.-]*)\s*>|<([a-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
  let last = 0
  for (const match of source.matchAll(tagRe)) {
    const [full, closeTag, openTag, rawAttrs, selfClose] = match
    // Text between tags renders too — dropping it made every proxy screenshot textless.
    const text = source.slice(last, match.index)
    last = match.index + full.length
    if (text.trim()) {
      stack[stack.length - 1].children.push({
        tag: '#text',
        attrs: {},
        text,
        children: [],
      })
    }
    if (full.startsWith('<!--')) {
      continue
    }
    if (closeTag) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === closeTag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const attrs = {}
    for (const attr of rawAttrs.matchAll(
      /([\w:@\-.]+)\s*(?:=\s*"([^"]*)"|=\s*'([^']*)')?/g,
    )) {
      attrs[attr[1]] = attr[2] ?? attr[3] ?? ''
    }
    const node = { tag: openTag, attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClose && !VOID_TAGS.has(openTag)) {
      stack.push(node)
    }
  }
  return root.children
}
/* eslint-enable regexp/no-super-linear-backtracking */

/** Group wx:if / wx:elif / wx:else siblings so only one branch renders. */
function groupIfChains(children) {
  const out = []
  for (const node of children) {
    const hasChain
      = node.attrs
        && (node.attrs['wx:if'] !== undefined
          || node.attrs['wx:elif'] !== undefined
          || node.attrs['wx:else'] !== undefined)
    if (hasChain) {
      const last = out[out.length - 1]
      if (
        last
        && last.chain
        && (node.attrs['wx:elif'] !== undefined
          || node.attrs['wx:else'] !== undefined)
      ) {
        last.chain.branches.push(node)
        continue
      }
      if (node.attrs['wx:if'] !== undefined) {
        out.push({ chain: { branches: [node] } })
        continue
      }
    }
    out.push({ chain: false, node })
  }
  return out
}

export function renderToHtml(nodes, scope, ctx) {
  let html = ''
  for (const item of groupIfChains(nodes)) {
    if (item.chain) {
      const branch = item.chain.branches.find((b) => {
        if (b.attrs['wx:if'] !== undefined) {
          return truthy(b.attrs['wx:if'], scope)
        }
        if (b.attrs['wx:elif'] !== undefined) {
          return truthy(b.attrs['wx:elif'], scope)
        }
        return true
      })
      html += renderNode(branch, scope, ctx)
      continue
    }
    html += renderNode(item.node, scope, ctx)
  }
  return html
}

/** Inline rpx -> px at the fixed 375px viewport (1 design px = 2rpx). */
function rpxToPx(value) {
  return String(value).replace(
    /(-?[\d.]+)rpx/g,
    (_, n) =>
      `${(Number.parseFloat(n) / 2).toFixed(3).replace(/\.?0+$/, '')}px`,
  )
}

function renderNode(node, scope, ctx) {
  if (!node) {
    return ''
  }
  if (node.tag === '#text') {
    const out = interpolate(node.text ?? '', scope)
    return String(out ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
  const attrs = node.attrs ?? {}
  if (attrs['wx:for'] !== undefined) {
    const list
      = evalExpr(String(attrs['wx:for']).replace(/^\{\{|\}\}$/g, ''), scope)
        ?? []
    const item = attrs['wx:for-item'] ?? 'item'
    const index = attrs['wx:for-index'] ?? 'index'
    return list
      .map((value, i) =>
        renderNode(
          { ...node, attrs: { ...attrs, 'wx:for': undefined } },
          { ...scope, [item]: value, [index]: i, [`${index}In`]: undefined },
          ctx,
        ),
      )
      .join('')
  }

  const childHtml = renderToHtml(node.children ?? [], scope, ctx)

  // mip-icon computes its data-URI in JS; the proxy emulates that data path so
  // registry glyphs land in the screenshot (see lib/mip-icons.mjs).
  if (node.tag === 'mip-icon' && ctx.renderMipIcon) {
    return ctx.renderMipIcon({
      name: String(interpolate(attrs.name, scope) ?? ''),
      size: Number(interpolate(attrs.size, scope) ?? 0),
      color: String(interpolate(attrs.color, scope) ?? '#ffffff'),
    })
  }

  const resolved = ctx.resolveComponent?.(node.tag, ctx.usingComponents)
  if (resolved) {
    const props = { ...resolved.defaults }
    for (const [key, value] of Object.entries(attrs)) {
      if (
        key.startsWith('wx:')
        || key.startsWith('bind')
        || key.startsWith('catch')
        || key === 'class'
        || key === 'id'
        || key === 'style'
      ) {
        continue
      }
      // WeChat maps kebab-case attributes onto camelCase properties; the proxy must too,
      // or role-key/target-summary/fill-px never reach the component.
      props[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = interpolate(
        value,
        scope,
      )
    }
    // Components whose templates read JS-computed data (observer-built `view`) need the
    // host to supply it; ctx.componentData emulates that data path per tag.
    const data = ctx.componentData?.(node.tag, props) ?? {}
    const id = `c${(ctx.instanceCount += 1)}`
    ctx.componentStyles.push({ id, css: resolved.css })
    const inner = renderToHtml(
      resolved.nodes,
      { ...props, ...data },
      {
        ...ctx,
        slotHtml: childHtml,
        usingComponents: resolved.usingComponents,
      },
    )
    const outerStyle = rpxToPx(String(interpolate(attrs.style, scope) ?? ''))
    return `<div class="wx-comp ${interpolate(attrs.class, scope)}" id="${id}"${outerStyle ? ` style="${outerStyle}"` : ''}>${inner}</div>`
  }

  if (node.tag === 'slot') {
    return ctx.slotHtml || childHtml || ''
  }
  const tag = TAG_MAP[node.tag] ?? (node.tag.includes('-') ? 'div' : node.tag)
  if (!tag) {
    return childHtml
  }

  const styleParts = []
  const declaredStyle = rpxToPx(interpolate(attrs.style, scope) ?? '')
  if (declaredStyle) {
    styleParts.push(declaredStyle)
  }
  if (tag === 'img') {
    styleParts.push(
      `object-fit:${OBJECT_FIT[attrs.mode ?? 'scaleToFill'] ?? 'fill'}`,
    )
    if (attrs['lazy-load'] !== undefined) {
      styleParts.push('')
    }
  }
  if (node.tag === 'scroll-view' && String(attrs['scroll-y']) === 'true') {
    styleParts.push('overflow-y:auto')
  }
  if (node.tag === 'scroll-view' && String(attrs['scroll-x']) === 'true') {
    styleParts.push('overflow-x:auto;white-space:nowrap')
  }

  const attrStrings = []
  for (const [key, value] of Object.entries(attrs)) {
    // style is emitted once from styleParts — re-emitting the raw attribute produced
    // duplicate style="" (and style="undefined") in the generated document.
    if (
      key.startsWith('wx:')
      || key.startsWith('bind')
      || key.startsWith('catch')
      || key.startsWith('aria')
      || key === 'data'
      || key === 'style'
    ) {
      continue
    }
    const out = interpolate(value, scope)
    if (key === 'class') {
      attrStrings.push(`class="${rpxToPx(out ?? '')}"`)
    }
    else if (key === 'src') {
      attrStrings.push(`src="${ctx.resolveAsset?.(out) ?? out}"`)
    }
    else if (key === 'hidden') {
      if (out !== '' && out !== 'false') {
        attrStrings.push('hidden')
      }
    }
    else if (
      [
        'mode',
        'fade-show',
        'selectable',
        'placeholder-class',
        'hover-class',
        'type',
        'confirm-type',
      ].includes(key)
    ) {
      continue
    }
    else if (key === 'placeholder') {
      attrStrings.push(`placeholder="${out}"`)
    }
    else if (key === 'value') {
      attrStrings.push(`value="${out}"`)
    }
    else {
      attrStrings.push(`${key}="${out}"`)
    }
  }
  if (styleParts.length) {
    attrStrings.push(`style="${styleParts.filter(Boolean).join(';')}"`)
  }

  const inner = tag === 'input' || tag === 'img' ? '' : childHtml
  return `<${tag} ${attrStrings.join(' ')}>${inner}</${tag}>`
}

/** rpx -> px at the given viewport width, and page -> body for browser rendering. */
export function toBrowserCss(css, viewportWidth = 375) {
  return css
    .replace(
      /(-?[\d.]+)rpx/g,
      (_, n) => `${(Number.parseFloat(n) * viewportWidth) / 750}px`,
    )
    .replace(/(^|[\s;{])page\b/g, '$1body')
    .replace(/@[a-z-][^;{]*;|@[a-z-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, m =>
      m.startsWith('@media') || m.startsWith('@supports') ? m : '')
}

export function scopeCss(css, instanceId) {
  return css.replace(/(^|\})\s*([^{}@\s][^{}@]*)\{/g, (_, end, selector) => {
    if (selector.trim().startsWith('@')) {
      return `${end}${selector}{`
    }
    const scoped = selector
      .split(',')
      .map((part) => {
        const s = part.trim()
        if (!s || s === 'from' || s === 'to') {
          return part
        }
        return `#${instanceId} ${s}`
      })
      .join(',')
    return `${end}${scoped}{`
  })
}

/** Reads a weapp component's property defaults without executing its JS. */
export function readPropertyDefaults(jsSource) {
  const defaults = {}
  const block
    = jsSource.match(/properties:\s*\{([\s\S]*?)\n\s{2}\}/)?.[1] ?? ''
  for (const match of block.matchAll(
    /(\w+):\s*\{\s*type:\s*[\w.]+(?:\(\))?(?:,\s*value:\s*([^,}\n]+))?/g,
  )) {
    if (match[2] === undefined) {
      continue
    }
    const raw = match[2].trim()
    try {
      defaults[match[1]]
        = raw.startsWith('[') || raw.startsWith('{')
          ? JSON.parse(raw.replace(/'/g, '"'))
          : JSON.parse(raw)
    }
    catch {
      defaults[match[1]] = raw.replace(/^['"]|['"]$/g, '')
    }
  }
  return defaults
}

export function createComponentResolver({
  srcDir,
  usingComponents = {},
  rootDir,
}) {
  const cache = new Map()
  return function resolve(tag, extraUsingComponents) {
    // Nested components register their children in their own json; the tag is
    // looked up in the rendering component's map first, then the page/app map.
    const target = extraUsingComponents?.[tag] ?? usingComponents[tag]
    if (!target) {
      return null
    }
    const cacheKey = `${tag}@${target}`
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)
    }
    let base
    if (target.startsWith('tdesign-miniprogram/')) {
      base = path.join(
        rootDir,
        'node_modules/tdesign-miniprogram/miniprogram_dist',
        target.slice('tdesign-miniprogram/'.length),
      )
    }
    else if (target.startsWith('/')) {
      base = path.join(srcDir, target.slice(1))
    }
    else if (target.startsWith('@')) {
      return null
    }
    else {
      base = path.join(srcDir, target)
    }
    // usingComponents entries point at a component file with or without the
    // trailing /index; accept both so `/components/x/index` and `/components/x` work.
    const read = (ext) => {
      for (const candidate of [`${base}.${ext}`, `${base}/index.${ext}`]) {
        if (fs.existsSync(candidate)) {
          return fs.readFileSync(candidate, 'utf8')
        }
      }
      return ''
    }
    const wxml = read('wxml') || read('xml')
    if (!wxml) {
      return null
    }
    let json = {}
    try {
      json = JSON.parse(read('json') || '{}')
    }
    catch {
      json = {}
    }
    const entry = {
      nodes: parseWxml(wxml),
      css: toBrowserCss(read('wxss') || read('css')),
      defaults: readPropertyDefaults(read('js') || read('ts')),
      usingComponents: json.usingComponents ?? {},
    }
    cache.set(cacheKey, entry)
    return entry
  }
}
