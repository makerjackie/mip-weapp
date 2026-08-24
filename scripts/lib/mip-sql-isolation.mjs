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
  new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${TARGET}`, 'gi'),
  new RegExp(`\\bALTER\\s+TABLE\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${TARGET}`, 'gi'),
  new RegExp(`\\bREFERENCES\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bINSERT\\s+INTO\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bREPLACE\\s+INTO\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bDELETE\\s+FROM\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bTRUNCATE\\s+TABLE\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bRENAME\\s+TABLE\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+\`?${IDENTIFIER}\`?\\s+ON\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bLOCK\\s+TABLES\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bJOIN\\s+${TARGET}`, 'gi'),
  new RegExp(`\\bFROM\\s+${TARGET}`, 'gi'),
  new RegExp(`(?:^|;)\\s*UPDATE\\s+${TARGET}`, 'gim'),
])
const SPECIAL_ON_RELATION_PATTERN = new RegExp(`\\bON\\s+${TARGET}`, 'gi')
const SPECIAL_ON_STATEMENT = /^\s*(?:CREATE\s+TRIGGER|GRANT|REVOKE)\b/i
const SQL_START = /^\s*(?:SELECT|WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|LOCK|SHOW|DESCRIBE|FROM|(?:INNER|LEFT|RIGHT|CROSS)\s+JOIN)\b/i
const SQL_SIGNAL = /\b(?:SELECT|WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE)\b/
const RELATION_SIGNAL = /\b(?:FROM|JOIN|REFERENCES|INTO|TABLE)\b/i

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
    for (const pattern of RELATION_PATTERNS) {
      pattern.lastIndex = 0
      for (const match of cleaned.matchAll(pattern)) {
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
