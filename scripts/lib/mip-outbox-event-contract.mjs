import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const ignoredDirectoryNames = new Set(['node_modules', 'tests'])
const eventTypePattern = /^(?=[a-z0-9_.-]*\.)[a-z][a-z0-9_.-]{2,79}$/
const outboxInsertPattern = /INSERT\s+INTO\s+mip_outbox_events\b/i

export function verifyOutboxEventContract({ cwd, sourceRoots }) {
  const sources = collectSources(path.resolve(cwd), sourceRoots)
  const producers = sources.filter(source => source.relativeRoot !== 'cloudfunctions/mip-outbox-worker')
  const sites = producers.flatMap(findOutboxInsertSites)
  const genericSites = sites.filter(site => site.forwarded)
  const calls = producers.flatMap(source => findWriterCalls(source, sites, genericSites))
  for (const site of genericSites) {
    if (!calls.some(call => call.writerSite === site)) {
      throw new Error(`Outbox writer has no statically enumerable producer calls: ${location(site.source, site.node)}`)
    }
  }
  const producerEventTypes = new Set([...sites, ...calls].flatMap(site => site.eventTypes))
  if (!producerEventTypes.size) {
    throw new Error('Outbox producer event catalog is empty')
  }

  const projector = sources.find(source => source.relativePath === 'cloudfunctions/mip-outbox-worker/domain/projector.js')
  if (!projector) {
    throw new Error('Missing mip-outbox-worker projector source')
  }
  const projectedEventTypes = findProjectedEventTypes(projector)
  const noProjectionEventTypes = findNoProjectionEventTypes(projector)
  const overlap = [...projectedEventTypes].filter(value => noProjectionEventTypes.has(value))
  if (overlap.length) {
    throw new Error(`Outbox event types cannot be both projected and no-op: ${overlap.sort().join(', ')}`)
  }
  const unsupported = [...producerEventTypes]
    .filter(value => !projectedEventTypes.has(value) && !noProjectionEventTypes.has(value))
    .sort()
  if (unsupported.length) {
    throw new Error(`Outbox producer event types are not classified by projector: ${unsupported.join(', ')}`)
  }
  return Object.freeze({
    producerEventTypes: Object.freeze([...producerEventTypes].sort()),
    projectedEventTypes: Object.freeze([...projectedEventTypes].sort()),
    noProjectionEventTypes: Object.freeze([...noProjectionEventTypes].sort()),
  })
}

function collectSources(root, sourceRoots) {
  const sources = []
  for (const relativeRoot of sourceRoots) {
    const absoluteRoot = path.resolve(root, relativeRoot)
    const relative = path.relative(root, absoluteRoot)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Outbox verification root escapes cwd: ${absoluteRoot}`)
    }
    const stack = [absoluteRoot]
    while (stack.length) {
      const current = stack.pop()
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolutePath = path.join(current, entry.name)
        if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name)) {
          stack.push(absolutePath)
        }
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          const relativePath = path.relative(root, absolutePath)
          const ast = ts.createSourceFile(relativePath, fs.readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
          if (ast.parseDiagnostics.length) {
            throw new Error(`Cannot parse outbox source: ${relativePath}`)
          }
          sources.push({ absolutePath, relativePath, relativeRoot, ast })
        }
      }
    }
  }
  return sources
}

function findOutboxInsertSites(source) {
  const sites = []
  visit(source.ast, (node) => {
    if (!ts.isCallExpression(node) || !node.arguments.length) {
      return
    }
    const sqlNode = resolveAlias(node.arguments[0])
    const sql = staticSql(sqlNode)
    const possibleSql = sql ?? sqlFragments(node.arguments[0])
    if (!outboxInsertPattern.test(possibleSql)) {
      return
    }
    if (sql === null) {
      fail(source, node, 'Outbox SQL must be statically enumerable')
    }
    const expressions = eventExpressionsFromSql(sql, node.arguments[1], source, node)
    const eventTypes = []
    let forwarded
    for (const expression of expressions) {
      const values = eventValues(expression)
      if (values !== null) {
        eventTypes.push(...values)
      }
      else {
        const parameter = forwardedParameter(expression)
        if (!parameter || expressions.length !== 1) {
          fail(source, node)
        }
        forwarded = parameter
      }
    }
    sites.push({ source, node, eventTypes, forwarded, writerName: functionName(containingFunction(node)) })
  })
  return sites
}

function eventExpressionsFromSql(sql, paramsNode, source, node) {
  const match = sql.match(/INSERT\s+INTO\s+mip_outbox_events\s*\(([^)]+)\)\s*VALUES\s*/i)
  if (!match) {
    fail(source, node, 'Unsupported outbox INSERT syntax')
  }
  const columns = match[1].split(',').map(value => value.trim().replaceAll('`', '').toLowerCase())
  const eventIndex = columns.indexOf('event_type')
  if (eventIndex < 0) {
    fail(source, node, 'Outbox INSERT must name event_type')
  }
  let remaining = sql.slice(match.index + match[0].length).trimStart()
  let parameterOffset = 0
  const expressions = []
  do {
    const tuple = sqlTuple(remaining)
    if (!tuple || tuple.values.length !== columns.length) {
      fail(source, node, 'Unsupported outbox VALUES syntax')
    }
    const value = tuple.values[eventIndex].trim()
    if (/^'[^']*'$/.test(value)) {
      expressions.push(ts.factory.createStringLiteral(value.slice(1, -1)))
    }
    else if (value === '?') {
      const params = resolveAlias(paramsNode)
      if (!params || !ts.isArrayLiteralExpression(params) || params.elements.some(ts.isSpreadElement)) {
        fail(source, node)
      }
      const precedingCount = tuple.values.slice(0, eventIndex).reduce((count, part) => count + sqlPlaceholderCount(part), 0)
      const expression = params.elements[parameterOffset + precedingCount]
      if (!expression) {
        fail(source, node)
      }
      expressions.push(expression)
    }
    else {
      fail(source, node, 'Outbox event_type must be a literal or bound parameter')
    }
    parameterOffset += tuple.values.reduce((count, part) => count + sqlPlaceholderCount(part), 0)
    remaining = remaining.slice(tuple.end).trimStart()
    if (!remaining.startsWith(',')) {
      break
    }
    remaining = remaining.slice(1).trimStart()
  } while (remaining)
  if (remaining && !/^ON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(remaining) && remaining !== ';') {
    fail(source, node, 'Unsupported outbox VALUES suffix')
  }
  return expressions
}

function sqlTuple(text) {
  if (!text.startsWith('(')) {
    return null
  }
  let depth = 0
  let quote = ''
  let start = 1
  const values = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (character === '\\') {
        index += 1
      }
      else if (character === quote) {
        if (text[index + 1] === quote) {
          index += 1
        }
        else {
          quote = ''
        }
      }
      continue
    }
    if (character === '\'' || character === '"') {
      quote = character
    }
    else if (character === '(') {
      depth += 1
    }
    else if (character === ')') {
      depth -= 1
      if (depth === 0) {
        values.push(text.slice(start, index).trim())
        return { values, end: index + 1 }
      }
    }
    else if (character === ',' && depth === 1) {
      values.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  return null
}

function sqlPlaceholderCount(value) {
  return (value.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g, '').match(/\?/g) || []).length
}

function findWriterCalls(source, sites, genericSites) {
  const calls = []
  const candidates = genericSites.filter(site => site.source.relativeRoot === source.relativeRoot)
  visit(source.ast, (node) => {
    if (!ts.isCallExpression(node)) {
      return
    }
    const name = callName(node.expression)
    const matching = candidates.filter(site => site.writerName && site.writerName === name)
    if (!matching.length) {
      return
    }
    // A same-name local implementation takes precedence over writers in other files.
    const local = sites.filter(site => site.source === source && site.writerName === name)
    const applicable = local.length ? local.filter(site => site.forwarded) : matching
    for (const writerSite of applicable) {
      const { argumentIndex, property } = writerSite.forwarded
      const argument = node.arguments[argumentIndex]
      const expression = property ? objectProperty(argument, property) : argument
      const eventTypes = eventValues(expression)
      if (eventTypes === null) {
        fail(source, node)
      }
      calls.push({ writerSite, eventTypes })
    }
  })
  return calls
}

function objectProperty(expression, name) {
  const value = resolveAlias(expression)
  if (!value || !ts.isObjectLiteralExpression(value) || value.properties.some(ts.isSpreadAssignment)) {
    return undefined
  }
  const properties = value.properties.filter(property => propertyName(property.name) === name)
  if (properties.length !== 1) {
    return undefined
  }
  const property = properties[0]
  if (ts.isPropertyAssignment(property)) {
    return property.initializer
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name
  }
  return undefined
}

function forwardedParameter(expression) {
  const node = resolveAlias(expression)
  if (!node) {
    return null
  }
  const property = ts.isPropertyAccessExpression(node) && node.name.text === 'eventType' ? 'eventType' : null
  const identifier = property ? node.expression : node
  if (!ts.isIdentifier(identifier)) {
    return null
  }
  const binding = bindingOf(identifier)
  if (!binding || !ts.isParameter(binding)) {
    return null
  }
  const fn = binding.parent
  const argumentIndex = fn.parameters.indexOf(binding)
  if (ts.isIdentifier(binding.name)) {
    return { argumentIndex, property }
  }
  if (ts.isObjectBindingPattern(binding.name)) {
    const element = binding.name.elements.find(item => ts.isIdentifier(item.name) && item.name.text === identifier.text)
    if (element && propertyName(element.propertyName || element.name) === 'eventType') {
      return { argumentIndex, property: 'eventType' }
    }
  }
  return null
}

function eventValues(expression, seen = new Set()) {
  if (!expression || seen.has(expression)) {
    return null
  }
  const node = resolveAlias(expression)
  if (!node) {
    return null
  }
  const next = new Set(seen).add(expression)
  if (isStringLike(node)) {
    return eventTypePattern.test(node.text) ? [node.text] : null
  }
  if (ts.isConditionalExpression(node)) {
    const left = eventValues(node.whenTrue, next)
    const right = eventValues(node.whenFalse, next)
    return left !== null && right !== null ? [...new Set([...left, ...right])] : null
  }
  return null
}

function bindingOf(identifier) {
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) {
          continue
        }
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text) {
            return declaration
          }
        }
      }
    }
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text) {
          return parameter
        }
        if (ts.isObjectBindingPattern(parameter.name) && parameter.name.elements.some(element => (
          ts.isIdentifier(element.name) && element.name.text === identifier.text
        ))) {
          return parameter
        }
      }
    }
  }
  return null
}

function resolveAlias(node, seen = new Set()) {
  if (!node || seen.has(node)) {
    return undefined
  }
  if (ts.isParenthesizedExpression(node)) {
    return resolveAlias(node.expression, new Set(seen).add(node))
  }
  if (!ts.isIdentifier(node)) {
    return node
  }
  const binding = bindingOf(node)
  if (!binding || !ts.isVariableDeclaration(binding)) {
    return node
  }
  if (!(binding.parent.flags & ts.NodeFlags.Const) || !binding.initializer) {
    return undefined
  }
  return resolveAlias(binding.initializer, new Set(seen).add(node))
}

function staticSql(expression, seen = new Set()) {
  const node = resolveAlias(expression)
  if (!node || seen.has(node)) {
    return null
  }
  const next = new Set(seen).add(node)
  if (isStringLike(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    let result = node.head.text
    for (const span of node.templateSpans) {
      const value = staticSql(span.expression, next)
      if (value === null) {
        return null
      }
      result += value + span.literal.text
    }
    return result
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticSql(node.left, next)
    const right = staticSql(node.right, next)
    return left !== null && right !== null ? left + right : null
  }
  // Constant map callbacks used for bulk VALUES all emit the same SQL tuple.
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'join' && node.arguments.length === 1
    && isStringLike(node.arguments[0]) && /^,\s*$/.test(node.arguments[0].text)) {
    const mapped = resolveAlias(node.expression.expression)
    if (mapped && ts.isCallExpression(mapped) && ts.isPropertyAccessExpression(mapped.expression)
      && mapped.expression.name.text === 'map' && mapped.arguments.length === 1) {
      const callback = mapped.arguments[0]
      if (ts.isArrowFunction(callback) && callback.parameters.length === 0 && !ts.isBlock(callback.body)) {
        return staticSql(callback.body, next)
      }
    }
  }
  return null
}

function sqlFragments(expression, seen = new Set()) {
  if (!expression || seen.has(expression)) {
    return ''
  }
  const next = new Set(seen).add(expression)
  if (ts.isIdentifier(expression)) {
    const binding = bindingOf(expression)
    if (binding && ts.isVariableDeclaration(binding) && binding.initializer) {
      return sqlFragments(binding.initializer, next)
    }
  }
  const node = resolveAlias(expression) || expression
  if (!node) {
    return ''
  }
  if (isStringLike(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(span => span.literal.text).join('')
  }
  if (ts.isBinaryExpression(node)) {
    return sqlFragments(node.left, next) + sqlFragments(node.right, next)
  }
  return ''
}

function findProjectedEventTypes(source) {
  let fn
  visit(source.ast, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'projectEvent') {
      fn = node
    }
  })
  if (!fn) {
    throw new Error('Missing projectEvent implementation')
  }
  const eventTypes = new Set()
  visit(fn, (node) => {
    if (ts.isCaseClause(node) && isStringLike(node.expression) && eventTypePattern.test(node.expression.text)) {
      eventTypes.add(node.expression.text)
    }
  })
  if (!eventTypes.size) {
    throw new Error('Projected outbox event catalog is empty')
  }
  return eventTypes
}

function findNoProjectionEventTypes(source) {
  let initializer
  visit(source.ast, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'NO_PROJECTION_EVENT_TYPES') {
      initializer = node.initializer
    }
  })
  if (!initializer || !ts.isNewExpression(initializer) || callName(initializer.expression) !== 'Set') {
    throw new Error('Missing NO_PROJECTION_EVENT_TYPES catalog')
  }
  const array = resolveAlias(initializer.arguments?.[0])
  if (!array || !ts.isArrayLiteralExpression(array)) {
    throw new Error('No-projection catalog must be statically enumerable')
  }
  const events = array.elements.map(element => eventValues(element))
  if (!events.length || events.includes(null)) {
    throw new Error('No-projection catalog must be statically enumerable')
  }
  return new Set(events.flat())
}

function containingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) && functionName(current)) {
      return current
    }
  }
  return undefined
}

function functionName(node) {
  if (!node) {
    return ''
  }
  if (node.name) {
    return propertyName(node.name)
  }
  if (node.parent && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent))) {
    return propertyName(node.parent.name)
  }
  return ''
}

function callName(expression) {
  return ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : ''
}

function propertyName(node) {
  return node && (ts.isIdentifier(node) || isStringLike(node)) ? node.text : ''
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function location(source, node) {
  return `${source.relativePath}:${source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast)).line + 1}`
}

function fail(source, node, message = 'Outbox producer event type must be statically enumerable') {
  throw new Error(`${message}: ${location(source, node)}`)
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, child => visit(child, callback))
}
