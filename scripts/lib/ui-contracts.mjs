import fs from 'node:fs'
import path from 'node:path'

function readAttribute(attributes, name) {
  return attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || ''
}

function normalizeLabel(body) {
  return body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function parseAnnotatedViewItems(source) {
  const stack = []
  const items = []
  for (const match of source.matchAll(/<\/?view\b[^>]*>/g)) {
    const tag = match[0]
    if (tag.startsWith('</')) {
      const opened = stack.pop()
      if (!opened || readAttribute(opened.attributes, 'data-tab-bar-item') !== 'true') {
        continue
      }
      items.push({
        start: opened.start,
        attributes: opened.attributes,
        body: source.slice(opened.bodyStart, match.index),
      })
      continue
    }
    if (tag.endsWith('/>')) {
      continue
    }
    stack.push({
      start: match.index,
      bodyStart: match.index + tag.length,
      attributes: tag.slice('<view'.length, -1),
    })
  }
  return items.sort((left, right) => left.start - right.start)
}

export function parseTabBarItems(source) {
  const tdesignItems = [...source.matchAll(/<t-tab-bar-item\b([^>]*)>([\s\S]*?)<\/t-tab-bar-item>/g)]
    .map(match => ({
      value: readAttribute(match[1], 'value'),
      icon: readAttribute(match[1], 'icon'),
      label: normalizeLabel(match[2]),
    }))
  if (tdesignItems.length > 0) {
    return tdesignItems
  }
  return parseAnnotatedViewItems(source)
    .map(item => ({
      value: readAttribute(item.attributes, 'data-value'),
      icon: readAttribute(item.body.match(/<t-icon\b([^>]*)>/)?.[1] || '', 'name'),
      label: normalizeLabel(item.body),
    }))
}

export function assertTabBarParity(leftSource, rightSource, assert, label) {
  const left = parseTabBarItems(leftSource)
  const right = parseTabBarItems(rightSource)
  assert(left.length > 0, `${label} standalone navigation is empty`)
  assert(right.length > 0, `${label} embedded navigation is empty`)
  assert(
    JSON.stringify(left) === JSON.stringify(right),
    `${label} standalone and embedded destinations, labels, or icons drifted`,
  )
}

export function assertOfficialCustomTabBar(source, appJson, assert, label, { compiled = false, wxss = '' } = {}) {
  assert(!source.includes('theme="tag"'), `${label} must not use TDesign theme="tag"`)
  assert(!source.includes('<cover-view'), `${label} must not place a native cover-view over the interactive TabBar`)
  const combined = `${source}\n${wxss}`
  assert(combined.includes('env(safe-area-inset-bottom)') || combined.includes('safe-area-inset-bottom'), `${label} must reserve the device safe area`)
  assert(
    /height:\s*96rpx/.test(wxss) || (!compiled && source.includes('h-[96rpx]')),
    `${label} must use the native 48px / 96rpx content height`,
  )
  assert(
    /background(?:-color)?:\s*#[0-9A-Fa-f]{3,8}/.test(wxss),
    `${label} must paint an opaque background in its own stylesheet; custom-tab-bar is not a child of page`,
  )
  assert(source.includes('<t-icon'), `${label} visible icons must use TDesign t-icon`)
  assert(!source.includes('<image') && !source.includes('assets/tab'), `${label} must not render raster tab icons in the custom component`)
  assert(source.includes('selected'), `${label} must sync the selected index`)
  const list = appJson?.tabBar?.list || []
  assert(list.length >= 2 && list.length <= 5, `${label} app.json tabBar.list must have 2-5 items`)
  for (const item of list) {
    assert(item.iconPath && item.selectedIconPath, `${label} ${item.pagePath || 'tab'} is missing fallback iconPath`)
  }
}

function findIconStyleSheet(repositoryRoot) {
  const candidates = [
    path.join(repositoryRoot, 'node_modules', 'tdesign-miniprogram', 'miniprogram_dist', 'icon', 'icon.wxss'),
    path.join(repositoryRoot, 'node_modules', 'tdesign-miniprogram', 'icon', 'icon.wxss'),
  ]
  const file = candidates.find(candidate => fs.existsSync(candidate))
  if (!file) {
    throw new Error('TDesign icon catalog is missing; run pnpm install before source verification')
  }
  return file
}

function readTDesignIconCatalog(repositoryRoot) {
  const source = fs.readFileSync(findIconStyleSheet(repositoryRoot), 'utf8')
  return new Set(
    [...source.matchAll(/\.t-icon-([a-z0-9-]+)::?before\b/g)]
      .map(match => match[1]),
  )
}

function collectDeclaredIconNames(source) {
  const names = []
  for (const match of source.matchAll(/<t-icon\b([^>]*)>/g)) {
    const name = readAttribute(match[1], 'name')
    if (name && !name.includes('{{')) {
      names.push(name)
    }
  }
  for (const match of source.matchAll(/<t-tab-bar-item\b([^>]*)>/g)) {
    const value = readAttribute(match[1], 'icon')
    if (!value) {
      continue
    }
    if (value.includes('{{')) {
      names.push(...[...value.matchAll(/'([a-z0-9-]+)'/g)].map(icon => icon[1]))
    }
    else {
      names.push(value)
    }
  }
  return names
}

export function assertValidTDesignIconNames({
  sources,
  declaredNames = [],
  repositoryRoot,
  assert,
  label,
}) {
  const catalog = readTDesignIconCatalog(repositoryRoot)
  const names = new Set([...sources.flatMap(collectDeclaredIconNames), ...declaredNames])
  for (const name of names) {
    assert(catalog.has(name), `${label} uses an unknown TDesign icon: ${name}`)
  }
}

export function assertSemanticIconColors({ sources, assert, label }) {
  for (const source of sources) {
    for (const match of source.matchAll(/<t-icon\b([^>]*)>/g)) {
      const color = readAttribute(match[1], 'color')
      assert(!color.includes('#'), `${label} hard-codes a t-icon color instead of a semantic token: ${color}`)
    }
    for (const match of source.matchAll(/<t-tab-bar\b([^>]*)>/g)) {
      const customStyle = readAttribute(match[1], 'custom-style')
      const colorDeclarations = [...customStyle.matchAll(/--td-tab-bar-(?:active-)?color:\s*([^;]+)/g)]
      for (const declaration of colorDeclarations) {
        assert(!declaration[1].includes('#'), `${label} hard-codes a TabBar color instead of a semantic token: ${declaration[1]}`)
      }
    }
  }
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) {
    return []
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(filePath) : [filePath]
  })
}

export function assertCompiledTDesignRegistrations({
  buildRoot,
  assert,
  label,
}) {
  const componentContracts = [
    {
      tag: 't-icon',
      registration: 't-icon',
      expectedPath: 'tdesign-miniprogram/icon/icon',
    },
    {
      tag: 't-button',
      registration: 't-button',
      expectedPath: 'tdesign-miniprogram/button/button',
    },
  ]
  const appViews = walkFiles(buildRoot)
    .filter(file => file.endsWith('.wxml'))
    .filter(file => !file.includes(`${path.sep}miniprogram_npm${path.sep}`))

  for (const viewFile of appViews) {
    const source = fs.readFileSync(viewFile, 'utf8')
    for (const contract of componentContracts) {
      if (!source.includes(`<${contract.tag}`)) {
        continue
      }
      const configFile = viewFile.replace(/\.wxml$/, '.json')
      assert(fs.existsSync(configFile), `${path.relative(buildRoot, viewFile)} is missing its compiled JSON`)
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      assert(
        String(config.usingComponents?.[contract.registration] || '').includes(contract.expectedPath),
        `${path.relative(buildRoot, viewFile)} uses ${contract.tag} without a compiled TDesign registration`,
      )
    }
  }
}
