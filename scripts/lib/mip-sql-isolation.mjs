function extractJavaScriptStrings(source) {
  const strings = []
  let current = ''
  let quote = null
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (char === '\\') {
        current += char
        current += next || ''
        index += 1
      }
      else if (char === quote) {
        strings.push(current)
        current = ''
        quote = null
      }
      else {
        current += char
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
  }
  return strings
}

const IDENTIFIER = '[a-z_]\\w*'
const TARGET = `(?:\\$\\{([a-z_$][\\w$]*)\\}|\`?(${IDENTIFIER})\`?(?:\\s*\\.\\s*\`?(${IDENTIFIER})\`?)?)`
const RELATION_PATTERNS = Object.freeze([
  { pattern: new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bALTER\\s+TABLE\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bREFERENCES\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bINSERT\\s+INTO\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bREPLACE\\s+INTO\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bDELETE\\s+FROM\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bTRUNCATE\\s+TABLE\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bRENAME\\s+TABLE\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+\`?${IDENTIFIER}\`?\\s+ON\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bLOCK\\s+TABLES\\s+${TARGET}`, 'gi') },
  { pattern: new RegExp(`\\bJOIN\\s+${TARGET}`, 'gi'), allowsCte: true },
  { pattern: new RegExp(`\\bFROM\\s+${TARGET}`, 'gi'), allowsCte: true },
  { pattern: new RegExp(`(?:^|;)\\s*UPDATE\\s+${TARGET}`, 'gim') },
])
const SPECIAL_ON_RELATION_PATTERN = new RegExp(`\\bON\\s+${TARGET}`, 'gi')
const SPECIAL_ON_STATEMENT = /^\s*(?:CREATE\s+TRIGGER|GRANT|REVOKE)\b/i
const SQL_START = /^\s*(?:SELECT|WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|LOCK|SHOW|DESCRIBE|FROM|(?:INNER|LEFT|RIGHT|CROSS)\s+JOIN)\b/i
const SQL_SIGNAL = /\b(?:SELECT|WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE)\b/
const RELATION_SIGNAL = /\b(?:FROM|JOIN|REFERENCES|INTO|TABLE)\b/i

function skipWhitespace(source, start) {
  let cursor = start
  while (/\s/.test(source[cursor] || '')) {
    cursor += 1
  }
  return cursor
}

function readKeyword(source, start, keyword) {
  const value = source.slice(start, start + keyword.length)
  const next = source[start + keyword.length]
  return value.toUpperCase() === keyword && !/[\w$]/.test(next || '')
    ? start + keyword.length
    : null
}

function readIdentifier(source, start) {
  if (source[start] === '`') {
    let cursor = start + 1
    let value = ''
    while (cursor < source.length) {
      if (source[cursor] === '`' && source[cursor + 1] === '`') {
        value += '`'
        cursor += 2
      }
      else if (source[cursor] === '`') {
        return /^[a-z_]\w*$/i.test(value) ? { value, end: cursor + 1 } : null
      }
      else {
        value += source[cursor]
        cursor += 1
      }
    }
    return null
  }
  const match = source.slice(start).match(/^[a-z_]\w*/i)
  return match ? { value: match[0], end: start + match[0].length } : null
}

function skipParenthesized(source, start) {
  if (source[start] !== '(') {
    return null
  }
  let depth = 0
  let quote = null
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (quote) {
      if (char === '\\') {
        cursor += 1
      }
      else if (char === quote && next === quote) {
        cursor += 1
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
    }
    else if (char === '(') {
      depth += 1
    }
    else if (char === ')' && --depth === 0) {
      return cursor + 1
    }
  }
  return null
}

function findStatementEnd(source, start) {
  let quote = null
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (quote) {
      if (char === '\\') {
        cursor += 1
      }
      else if (char === quote && next === quote) {
        cursor += 1
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
    }
    else if (char === ';') {
      return cursor
    }
  }
  return source.length
}

function parseCteClause(source, start) {
  let cursor = skipWhitespace(source, start)
  const recursiveEnd = readKeyword(source, cursor, 'RECURSIVE')
  if (recursiveEnd !== null) {
    cursor = skipWhitespace(source, recursiveEnd)
  }
  const relations = new Set()

  while (cursor < source.length) {
    const identifier = readIdentifier(source, cursor)
    if (!identifier) {
      return null
    }
    cursor = skipWhitespace(source, identifier.end)
    if (source[cursor] === '(') {
      const columnsEnd = skipParenthesized(source, cursor)
      if (columnsEnd === null) {
        return null
      }
      cursor = skipWhitespace(source, columnsEnd)
    }
    const asEnd = readKeyword(source, cursor, 'AS')
    if (asEnd === null) {
      return null
    }
    cursor = skipWhitespace(source, asEnd)
    const queryEnd = skipParenthesized(source, cursor)
    if (queryEnd === null) {
      return null
    }
    relations.add(identifier.value.toLowerCase())
    cursor = skipWhitespace(source, queryEnd)
    if (source[cursor] !== ',') {
      break
    }
    cursor = skipWhitespace(source, cursor + 1)
  }

  return {
    relations,
    end: findStatementEnd(source, cursor),
  }
}

function findKeywordStarts(source, keyword) {
  const starts = []
  let quote = null
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (quote) {
      if (char === '\\') {
        cursor += 1
      }
      else if (char === quote && next === quote) {
        cursor += 1
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    const before = source[cursor - 1]
    const end = readKeyword(source, cursor, keyword)
    if (end !== null && !/[\w$]/.test(before || '')) {
      starts.push(cursor)
      cursor = end - 1
    }
  }
  return starts
}

function collectCteScopes(source) {
  const scopes = []
  for (const start of findKeywordStarts(source, 'WITH')) {
    const parsed = parseCteClause(source, start + 'WITH'.length)
    if (parsed?.relations.size) {
      scopes.push({ start, end: parsed.end, relations: parsed.relations })
    }
  }
  return scopes
}

function isCteReference(match, cteScopes) {
  const relation = String(match[2] || '').toLowerCase()
  return !match[1] && !match[3] && cteScopes.some(scope => (
    match.index >= scope.start
    && match.index < scope.end
    && scope.relations.has(relation)
  ))
}

export function findUnsafeMipSqlRelations(source, options = {}) {
  const allowedDynamicRelations = options.allowedDynamicRelations || {}
  const unsafe = []
  const candidates = options.sqlDocument === true
    ? [String(source || '')]
    : extractJavaScriptStrings(String(source || '')).filter(value => (
        SQL_START.test(value) || (SQL_SIGNAL.test(value) && RELATION_SIGNAL.test(value))
      ))

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const cteScopes = collectCteScopes(cleaned)
    for (const { pattern, allowsCte = false } of RELATION_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of cleaned.matchAll(pattern)) {
        if (allowsCte && isCteReference(match, cteScopes)) {
          continue
        }
        collectUnsafeMatch(match, allowedDynamicRelations, unsafe)
      }
    }
    for (const statement of cleaned.split(';').filter(value => SPECIAL_ON_STATEMENT.test(value))) {
      SPECIAL_ON_RELATION_PATTERN.lastIndex = 0
      for (const match of statement.matchAll(SPECIAL_ON_RELATION_PATTERN)) {
        collectUnsafeMatch(match, allowedDynamicRelations, unsafe)
      }
    }
  }
  return unsafe
}

function collectUnsafeMatch(match, allowedDynamicRelations, unsafe) {
  const dynamicName = match[1]
  const firstName = match[2]
  const secondName = match[3]
  if (dynamicName) {
    const allowed = allowedDynamicRelations[dynamicName]
    if (!Array.isArray(allowed)
      || allowed.length === 0
      || allowed.some(table => !/^mip_[a-z0-9_]+$/.test(table))) {
      unsafe.push({ kind: 'dynamic', relation: dynamicName })
    }
    return
  }
  const schema = secondName ? firstName : null
  const table = secondName || firstName
  if (schema === 'information_schema') {
    return
  }
  if (schema || !String(table || '').startsWith('mip_')) {
    unsafe.push({ kind: 'static', relation: schema ? `${schema}.${table}` : table })
  }
}
