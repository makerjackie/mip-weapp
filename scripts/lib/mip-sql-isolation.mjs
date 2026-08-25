function extractJavaScriptStrings(source) {
  const strings = []
  let cursor = 0

  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (char === '\'' || char === '"') {
      const value = readJavaScriptQuotedValue(source, cursor, char)
      strings.push(value.value)
      cursor = value.end
    }
    else if (char === '`') {
      const value = readJavaScriptTemplateValue(source, cursor)
      strings.push(value.value)
      cursor = value.end
    }
    else if (char === '/' && next === '/') {
      cursor = skipJavaScriptLineComment(source, cursor)
    }
    else if (char === '/' && next === '*') {
      cursor = skipJavaScriptBlockComment(source, cursor)
    }
    else {
      cursor += 1
    }
  }
  return strings
}

function readJavaScriptQuotedValue(source, start, quote) {
  let value = ''
  let cursor = start + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\\') {
      value += char
      value += source[cursor + 1] || ''
      cursor += 2
    }
    else if (char === quote) {
      return { end: cursor + 1, value }
    }
    else {
      value += char
      cursor += 1
    }
  }
  return { end: source.length, value }
}

function readJavaScriptTemplateValue(source, start) {
  let cursor = start + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === '\\') {
      cursor += 2
    }
    else if (char === '`') {
      return { end: cursor + 1, value: source.slice(start + 1, cursor) }
    }
    else if (char === '$' && source[cursor + 1] === '{') {
      cursor = skipJavaScriptTemplateExpression(source, cursor + 2)
    }
    else {
      cursor += 1
    }
  }
  return { end: source.length, value: source.slice(start + 1) }
}

function skipJavaScriptTemplateExpression(source, start) {
  let cursor = start
  let depth = 1
  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (char === '\'' || char === '"') {
      cursor = readJavaScriptQuotedValue(source, cursor, char).end
    }
    else if (char === '`') {
      cursor = readJavaScriptTemplateValue(source, cursor).end
    }
    else if (char === '/' && next === '/') {
      cursor = skipJavaScriptLineComment(source, cursor)
    }
    else if (char === '/' && next === '*') {
      cursor = skipJavaScriptBlockComment(source, cursor)
    }
    else if (char === '{') {
      depth += 1
      cursor += 1
    }
    else if (char === '}') {
      depth -= 1
      cursor += 1
      if (depth === 0) {
        return cursor
      }
    }
    else {
      cursor += 1
    }
  }
  return source.length
}

function readDynamicTemplateExpression(source, start) {
  if (source[start] !== '$' || source[start + 1] !== '{') {
    return null
  }
  const end = skipJavaScriptTemplateExpression(source, start + 2)
  const closed = source[end - 1] === '}'
  const value = source.slice(start + 2, closed ? end - 1 : end).trim()
  return {
    end,
    simpleIdentifier: /^[a-z_$][\w$]*$/i.test(value),
    value,
  }
}

function skipJavaScriptLineComment(source, start) {
  const lineEnd = source.indexOf('\n', start + 2)
  return lineEnd === -1 ? source.length : lineEnd + 1
}

function skipJavaScriptBlockComment(source, start) {
  const commentEnd = source.indexOf('*/', start + 2)
  return commentEnd === -1 ? source.length : commentEnd + 2
}

const SQL_START = /^\s*(?:SELECT|WITH|INSERT|INTO|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|LOCK|SHOW|DESCRIBE|FROM|JOIN|STRAIGHT_JOIN|(?:INNER|LEFT|RIGHT|CROSS)\s+JOIN)\b/i
const SQL_SIGNAL = /\b(?:SELECT|WITH|INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE)\b/
const RELATION_SIGNAL = /\b(?:FROM|JOIN|REFERENCES|INTO|TABLE)\b/i
const FOR_UPDATE_PRIVILEGES = new Set(['UPDATE', 'DELETE'])
const FROM_CLAUSE_END = new Set([
  'FOR',
  'GROUP',
  'HAVING',
  'LIMIT',
  'LOCK',
  'ORDER',
  'QUALIFY',
  'UNION',
  'WHERE',
  'WINDOW',
])
const RELATION_ALIAS_STOP = new Set([
  ...FROM_CLAUSE_END,
  'AS',
  'CROSS',
  'FORCE',
  'FULL',
  'IGNORE',
  'INDEX',
  'INNER',
  'JOIN',
  'KEY',
  'LEFT',
  'NATURAL',
  'ON',
  'PARTITION',
  'RIGHT',
  'SET',
  'STRAIGHT_JOIN',
  'TO',
  'USE',
  'USING',
  'READ',
  'WRITE',
])

function stripSqlComments(source) {
  let cleaned = ''
  let cursor = 0
  let quote = null
  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (quote) {
      cleaned += char
      if (char === '\\') {
        cleaned += next || ''
        cursor += 2
      }
      else if (char === quote && next === quote) {
        cleaned += next
        cursor += 2
      }
      else {
        if (char === quote) {
          quote = null
        }
        cursor += 1
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      cleaned += char
      cursor += 1
      continue
    }
    if (char === '#') {
      const end = sqlLineCommentEnd(source, cursor)
      cleaned += maskSqlComment(source.slice(cursor, end))
      cursor = end
      continue
    }
    if (isMysqlDashCommentStart(source, cursor)) {
      const end = sqlLineCommentEnd(source, cursor)
      cleaned += maskSqlComment(source.slice(cursor, end))
      cursor = end
      continue
    }
    if (char === '/' && next === '*') {
      const endMarker = source.indexOf('*/', cursor + 2)
      const end = endMarker === -1 ? source.length : endMarker + 2
      if (source[cursor + 2] === '!') {
        cleaned += '   '
        cleaned += source.slice(cursor + 3, endMarker === -1 ? end : endMarker)
        if (endMarker !== -1) {
          cleaned += '  '
        }
      }
      else {
        cleaned += maskSqlComment(source.slice(cursor, end))
      }
      cursor = end
      continue
    }
    cleaned += char
    cursor += 1
  }
  return cleaned
}

function isMysqlDashCommentStart(source, index) {
  if (source[index] !== '-' || source[index + 1] !== '-') {
    return false
  }
  const after = source[index + 2]
  if (after === undefined) {
    return true
  }
  const codePoint = after.codePointAt(0)
  return /\s/.test(after) || codePoint <= 0x1F || codePoint === 0x7F
}

function sqlLineCommentEnd(source, start) {
  const end = source.indexOf('\n', start)
  return end === -1 ? source.length : end
}

function maskSqlComment(comment) {
  return comment.replace(/[^\r\n]/g, ' ')
}

function deduplicateUnsafeRelations(unsafe) {
  return [...new Map(unsafe.map(item => [`${item.kind}:${item.relation}`, item])).values()]
}

function collectUnsafeTokenizedRelations(source, allowedDynamicRelations) {
  const unsafe = []
  const tokens = tokenizeLockingReadSql(source, { expandDynamicLocks: false })
  for (const statementTokens of splitSqlTokenStatements(tokens)) {
    const cteScopes = collectTokenCteScopes(statementTokens)
    const relations = [
      ...collectSelectQueryRelations(statementTokens),
      ...collectCommandRelations(statementTokens),
    ]
    for (const relation of relations) {
      collectUnsafeTokenizedRelation(relation, cteScopes, allowedDynamicRelations, unsafe)
    }
  }
  return unsafe
}

function splitSqlTokenStatements(tokens) {
  const statements = []
  let start = 0
  for (let index = 0; index <= tokens.length; index += 1) {
    if (index === tokens.length || tokens[index].value === ';') {
      if (index > start) {
        statements.push(tokens.slice(start, index))
      }
      start = index + 1
    }
  }
  return statements
}

function collectTokenCteScopes(tokens) {
  const scopes = []
  const depths = tokenDepths(tokens)
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].upper !== 'WITH') {
      continue
    }
    const names = new Set()
    let cursor = tokens[index + 1]?.upper === 'RECURSIVE' ? index + 2 : index + 1
    while (tokens[cursor]?.kind === 'word') {
      const name = tokens[cursor].value.toLowerCase()
      cursor += 1
      if (tokens[cursor]?.value === '(') {
        const columnsEnd = matchingTokenParenthesis(tokens, cursor)
        if (columnsEnd === null) {
          break
        }
        cursor = columnsEnd + 1
      }
      if (tokens[cursor]?.upper !== 'AS' || tokens[cursor + 1]?.value !== '(') {
        break
      }
      const queryEnd = matchingTokenParenthesis(tokens, cursor + 1)
      if (queryEnd === null) {
        break
      }
      names.add(name)
      cursor = queryEnd + 1
      if (tokens[cursor]?.value !== ',') {
        break
      }
      cursor += 1
    }
    if (names.size > 0) {
      scopes.push({
        endIndex: cteScopeEnd(tokens, depths, index),
        names,
        startIndex: index,
      })
    }
  }
  return scopes
}

function tokenDepths(tokens) {
  const depths = []
  let depth = 0
  for (const token of tokens) {
    depths.push(depth)
    if (token.value === '(') {
      depth += 1
    }
    else if (token.value === ')') {
      depth = Math.max(0, depth - 1)
    }
  }
  return depths
}

function cteScopeEnd(tokens, depths, withIndex) {
  const scopeDepth = depths[withIndex]
  for (let index = withIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].value === ')' && depths[index] === scopeDepth) {
      return index
    }
  }
  return tokens.length
}

function matchingTokenParenthesis(tokens, start) {
  let depth = 0
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') {
      depth += 1
    }
    if (tokens[index].value === ')' && --depth === 0) {
      return index
    }
  }
  return null
}

function collectSelectQueryRelations(tokens) {
  const activeBlocks = new Map()
  const relations = []
  const declaration = tokens[0]?.upper
  const declarationOn = ['GRANT', 'REVOKE'].includes(declaration)
    ? tokens.findIndex(token => token.upper === 'ON')
    : -1
  let depth = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === '(') {
      const block = nearestActiveQueryBlock(activeBlocks, depth)
      depth += 1
      if (block?.expectRelation) {
        if (['SELECT', 'WITH'].includes(tokens[index + 1]?.upper)) {
          block.expectRelation = false
        }
        else {
          block.relationGroupingDepths.add(depth)
        }
      }
      continue
    }
    if (token.value === ')') {
      const closingBlock = activeBlocks.get(depth)
      if (closingBlock?.expectRelation) {
        relations.push(missingTokenRelation(index))
      }
      nearestActiveQueryBlock(activeBlocks, depth)?.relationGroupingDepths.delete(depth)
      activeBlocks.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }
    if (token.upper === 'SELECT') {
      if (declarationOn !== -1 && index < declarationOn) {
        continue
      }
      activeBlocks.set(depth, {
        expectRelation: false,
        fromDepth: null,
        inFromClause: false,
        relationGroupingDepths: new Set(),
      })
      continue
    }

    const block = nearestActiveQueryBlock(activeBlocks, depth)
    if (!block) {
      continue
    }
    const isJoin = ['JOIN', 'STRAIGHT_JOIN'].includes(token.upper)
    if (token.upper === 'FROM' || (isJoin && block.inFromClause)) {
      block.expectRelation = true
      block.fromDepth = depth
      block.inFromClause = true
      continue
    }
    if (FROM_CLAUSE_END.has(token.upper)) {
      if (block.expectRelation) {
        relations.push(missingTokenRelation(index))
      }
      block.expectRelation = false
      block.inFromClause = false
      continue
    }
    if (block.expectRelation) {
      const relation = directRelationAt(tokens, index)
      if (relation) {
        relations.push(relation)
        index = relation.endIndex
      }
      block.expectRelation = false
      continue
    }
    if (block.inFromClause
      && token.value === ','
      && (depth === block.fromDepth || block.relationGroupingDepths.has(depth))) {
      block.expectRelation = true
    }
  }
  for (const block of activeBlocks.values()) {
    if (block.expectRelation) {
      relations.push(missingTokenRelation(tokens.length))
    }
  }
  return relations
}

function collectCommandRelations(tokens) {
  const relations = collectStandaloneRelationFragment(tokens)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.upper === 'UPDATE'
      && tokens[index - 1]?.upper !== 'FOR'
      && tokens[index - 1]?.upper !== 'KEY'
      && isSqlCommandAt(tokens, index)) {
      const start = skipTokenWords(tokens, index + 1, new Set(['IGNORE', 'LOW_PRIORITY']))
      relations.push(...collectTokenRelationList(tokens, start, new Set(['SET'])))
    }
    if (token.upper === 'DELETE' && isSqlCommandAt(tokens, index)) {
      const from = findTopLevelToken(tokens, index + 1, new Set(['FROM']))
      const using = findTopLevelToken(tokens, index + 1, new Set(['USING']))
      if (from !== -1) {
        relations.push(...collectTokenRelationList(
          tokens,
          from + 1,
          new Set(['LIMIT', 'ORDER', 'RETURNING', 'USING', 'WHERE']),
        ))
      }
      if (using !== -1) {
        relations.push(...collectTokenRelationList(
          tokens,
          using + 1,
          new Set(['LIMIT', 'ORDER', 'RETURNING', 'WHERE']),
        ))
      }
    }
    if (['INSERT', 'REPLACE'].includes(token.upper) && isSqlCommandAt(tokens, index)) {
      const into = findTopLevelToken(tokens, index + 1, new Set(['INTO']), 6)
      if (into !== -1) {
        pushDirectTokenRelation(tokens, into + 1, relations)
      }
    }
    if (token.upper === 'REFERENCES') {
      pushDirectTokenRelation(tokens, index + 1, relations)
    }
    const createTable = createTableTokenIndex(tokens, index)
    if (createTable !== -1) {
      const start = skipTokenSequence(tokens, createTable + 1, ['IF', 'NOT', 'EXISTS'])
      pushDirectTokenRelation(tokens, start, relations)
      const like = findTopLevelToken(tokens, start + 1, new Set(['LIKE']))
      if (like !== -1) {
        pushDirectTokenRelation(tokens, like + 1, relations)
      }
    }
    if (token.upper === 'ALTER' && tokens[index + 1]?.upper === 'TABLE') {
      const start = index + 2
      pushDirectTokenRelation(tokens, start, relations)
      const rename = findTopLevelToken(tokens, start + 1, new Set(['RENAME']))
      if (rename !== -1 && !['COLUMN', 'INDEX', 'KEY'].includes(tokens[rename + 1]?.upper)) {
        const destination = ['AS', 'TO'].includes(tokens[rename + 1]?.upper)
          ? rename + 2
          : rename + 1
        pushDirectTokenRelation(tokens, destination, relations)
      }
      const exchange = findTopLevelToken(tokens, start + 1, new Set(['EXCHANGE']))
      if (exchange !== -1) {
        const withToken = findTopLevelToken(tokens, exchange + 1, new Set(['WITH']))
        if (withToken !== -1 && tokens[withToken + 1]?.upper === 'TABLE') {
          pushDirectTokenRelation(tokens, withToken + 2, relations)
        }
      }
    }
    if (['ALTER', 'CREATE'].includes(token.upper)) {
      const view = schemaObjectTokenIndex(tokens, index, 'VIEW')
      if (view !== -1) {
        pushDirectTokenRelation(tokens, view + 1, relations)
      }
    }
    if (token.upper === 'DROP') {
      let cursor = tokens[index + 1]?.upper === 'TEMPORARY' ? index + 2 : index + 1
      if (['TABLE', 'VIEW'].includes(tokens[cursor]?.upper)) {
        cursor = skipTokenSequence(tokens, cursor + 1, ['IF', 'EXISTS'])
        relations.push(...collectTokenRelationList(tokens, cursor, new Set(['CASCADE', 'RESTRICT'])))
      }
      if (tokens[cursor]?.upper === 'INDEX') {
        const on = findTopLevelToken(tokens, cursor + 1, new Set(['ON']))
        if (on !== -1) {
          pushDirectTokenRelation(tokens, on + 1, relations)
        }
      }
    }
    if (token.upper === 'TRUNCATE') {
      const start = tokens[index + 1]?.upper === 'TABLE' ? index + 2 : index + 1
      pushDirectTokenRelation(tokens, start, relations)
    }
    if (token.upper === 'RENAME' && tokens[index + 1]?.upper === 'TABLE') {
      relations.push(...collectTokenRelationList(
        tokens,
        index + 2,
        new Set(),
        new Set(['TO']),
      ))
    }
    if (token.upper === 'LOCK' && tokens[index + 1]?.upper === 'TABLES') {
      relations.push(...collectTokenRelationList(tokens, index + 2, new Set()))
    }
    if (token.upper === 'CREATE') {
      const indexToken = tokens[index + 1]?.upper === 'UNIQUE' ? index + 2 : index + 1
      if (tokens[indexToken]?.upper === 'INDEX') {
        const on = findTopLevelToken(tokens, indexToken + 1, new Set(['ON']))
        if (on !== -1) {
          pushDirectTokenRelation(tokens, on + 1, relations)
        }
      }
    }
  }

  const first = tokens[0]?.upper
  const triggerIndex = createTriggerTokenIndex(tokens)
  if (['GRANT', 'REVOKE'].includes(first) || triggerIndex !== -1) {
    const on = findTopLevelToken(tokens, triggerIndex === -1 ? 1 : triggerIndex + 1, new Set(['ON']))
    if (on !== -1) {
      const start = ['GRANT', 'REVOKE'].includes(first)
        && ['FUNCTION', 'PROCEDURE', 'TABLE'].includes(tokens[on + 1]?.upper)
        ? on + 2
        : on + 1
      pushDirectTokenRelation(tokens, start, relations)
    }
  }
  return relations
}

function collectStandaloneRelationFragment(tokens) {
  let start = null
  if (['FROM', 'INTO', 'JOIN', 'STRAIGHT_JOIN'].includes(tokens[0]?.upper)) {
    start = 1
  }
  else if (['CROSS', 'FULL', 'INNER', 'LEFT', 'RIGHT'].includes(tokens[0]?.upper)) {
    const join = tokens[1]?.upper === 'OUTER' ? 2 : 1
    if (tokens[join]?.upper === 'JOIN') {
      start = join + 1
    }
  }
  if (start === null) {
    return []
  }
  return collectTokenRelationList(
    tokens,
    start,
    new Set([...FROM_CLAUSE_END, 'ON', 'SET', 'VALUES']),
  )
}

function createTableTokenIndex(tokens, commandIndex) {
  if (tokens[commandIndex]?.upper !== 'CREATE') {
    return -1
  }
  const table = tokens[commandIndex + 1]?.upper === 'TEMPORARY'
    ? commandIndex + 2
    : commandIndex + 1
  return tokens[table]?.upper === 'TABLE' ? table : -1
}

function createTriggerTokenIndex(tokens) {
  if (tokens[0]?.upper !== 'CREATE') {
    return -1
  }
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index].upper === 'TRIGGER') {
      return index
    }
    if (['DATABASE', 'EVENT', 'FUNCTION', 'INDEX', 'PROCEDURE', 'TABLE', 'VIEW'].includes(tokens[index].upper)) {
      return -1
    }
  }
  return -1
}

function schemaObjectTokenIndex(tokens, commandIndex, objectType) {
  const objectKeywords = new Set([
    'DATABASE',
    'EVENT',
    'FUNCTION',
    'INDEX',
    'PROCEDURE',
    'TABLE',
    'TRIGGER',
    'VIEW',
  ])
  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    if (!objectKeywords.has(tokens[index].upper)) {
      continue
    }
    return tokens[index].upper === objectType ? index : -1
  }
  return -1
}

function isSqlCommandAt(tokens, index) {
  if (index === 0) {
    return true
  }
  if (['BEGIN', 'DO', 'ELSE', 'THEN'].includes(tokens[index - 1]?.upper)) {
    return true
  }
  if (createTriggerTokenIndex(tokens) !== -1
    && tokens[index - 1]?.upper === 'ROW') {
    return true
  }
  if (tokens[0]?.upper !== 'WITH') {
    return false
  }
  let depth = 0
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (tokens[cursor].value === '(') {
      depth += 1
    }
    if (tokens[cursor].value === ')') {
      depth -= 1
    }
  }
  return depth === 0
}

function skipTokenWords(tokens, start, words) {
  let cursor = start
  while (words.has(tokens[cursor]?.upper)) {
    cursor += 1
  }
  return cursor
}

function skipTokenSequence(tokens, start, sequence) {
  let cursor = start
  for (const keyword of sequence) {
    if (tokens[cursor]?.upper === keyword) {
      cursor += 1
    }
  }
  return cursor
}

function findTopLevelToken(tokens, start, keywords, maximumDistance = Infinity) {
  let depth = 0
  for (let index = start; index < tokens.length && index - start <= maximumDistance; index += 1) {
    if (tokens[index].value === '(') {
      depth += 1
    }
    else if (tokens[index].value === ')') {
      depth = Math.max(0, depth - 1)
    }
    else if (depth === 0 && keywords.has(tokens[index].upper)) {
      return index
    }
  }
  return -1
}

function collectTokenRelationList(tokens, start, endKeywords, relationSeparators = new Set()) {
  const relations = []
  const groupingDepths = new Set()
  let depth = 0
  let expectRelation = true

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (depth === 0 && endKeywords.has(token.upper)) {
      break
    }
    if (token.value === '(') {
      depth += 1
      if (expectRelation) {
        if (['SELECT', 'WITH'].includes(tokens[index + 1]?.upper)) {
          expectRelation = false
        }
        else {
          groupingDepths.add(depth)
        }
      }
      continue
    }
    if (token.value === ')') {
      groupingDepths.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }
    if (['JOIN', 'STRAIGHT_JOIN'].includes(token.upper)) {
      expectRelation = true
      continue
    }
    if (relationSeparators.has(token.upper)) {
      expectRelation = true
      continue
    }
    if (expectRelation) {
      const relation = directRelationAt(tokens, index)
      if (relation) {
        relations.push(relation)
        index = relation.endIndex
      }
      expectRelation = false
      continue
    }
    if (token.value === ',' && (depth === 0 || groupingDepths.has(depth))) {
      expectRelation = true
    }
  }
  if (expectRelation) {
    relations.push(missingTokenRelation(tokens.length))
  }
  return relations
}

function pushDirectTokenRelation(tokens, index, relations) {
  const relation = directRelationAt(tokens, index)
  if (relation) {
    relations.push(relation)
  }
  else {
    relations.push(missingTokenRelation(index))
  }
}

function missingTokenRelation(startIndex) {
  return {
    display: '<missing-relation>',
    endIndex: startIndex,
    kind: 'dynamic',
    simpleIdentifier: false,
    startIndex,
    value: '<missing-relation>',
  }
}

function collectUnsafeTokenizedRelation(relation, cteScopes, allowedDynamicRelations, unsafe) {
  if (relation.kind === 'dynamic') {
    const unqualifiedSimple = relation.simpleIdentifier === true
      && relation.display === `\${${relation.value}}`
    const allowed = unqualifiedSimple ? allowedDynamicRelations[relation.value] : null
    if (!unqualifiedSimple
      || !Array.isArray(allowed)
      || allowed.length === 0
      || allowed.some(table => !/^mip_[a-z0-9_]+$/.test(table))) {
      unsafe.push({ kind: 'dynamic', relation: relation.value })
    }
    return
  }
  if (relation.display.includes('.')) {
    const [schema] = relation.display.toLowerCase().split('.')
    if (schema !== 'information_schema') {
      unsafe.push({ kind: 'static', relation: relation.display.toLowerCase() })
    }
    return
  }
  if (!isScopedTokenCteReference(relation, cteScopes) && !relation.value.startsWith('mip_')) {
    unsafe.push({ kind: 'static', relation: relation.value })
  }
}

function isScopedTokenCteReference(relation, cteScopes) {
  return cteScopes.some(scope => (
    relation.startIndex >= scope.startIndex
    && relation.startIndex < scope.endIndex
    && scope.names.has(relation.value)
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
    const cleaned = stripSqlComments(candidate)
    unsafe.push(...collectUnsafeTokenizedRelations(cleaned, allowedDynamicRelations))
  }
  return deduplicateUnsafeRelations(unsafe)
}

export function findLockingReadPrivilegeViolations(source, privilegeMap, options = {}) {
  const sqlDocument = options.sqlDocument === true
  const extracted = sqlDocument
    ? [String(source || '')]
    : extractJavaScriptStrings(String(source || ''))
  const candidates = extracted.map(normalizeJavaScriptEscapes)
  const violations = []

  if (!sqlDocument) {
    for (const fragment of candidates.filter(value => !/\bSELECT\b/i.test(value))) {
      const clause = lockingReadClauseIn(fragment)
      if (clause) {
        violations.push(unsupportedLockingReadViolation(
          clause,
          'LOCKING_READ_QUERY_CONTEXT',
          '<unbound-locking-clause>',
        ))
      }
    }
  }

  for (const candidate of candidates.filter(value => /\bSELECT\b/i.test(value))) {
    for (const block of lockingReadQueryBlocks(candidate)) {
      for (const lockingClause of block.lockingClauses) {
        for (const unsupported of block.unsupported.values()) {
          violations.push(unsupportedLockingReadViolation(
            lockingClause.clause,
            unsupported.missingPrivilege,
            unsupported.relation,
          ))
        }
        if (lockingClause.unsupportedAlias) {
          violations.push(unsupportedLockingReadViolation(
            lockingClause.clause,
            'LOCKING_READ_ALIAS',
            lockingClause.unsupportedAlias,
          ))
        }

        const scopedRelations = selectLockingReadRelations(
          block.relations,
          lockingClause,
          options.allowedDynamicRelations,
          violations,
        )
        for (const relation of scopedRelations) {
          const resolvedRelations = resolveLockingReadRelations(
            relation,
            options.allowedDynamicRelations,
          )
          if (!resolvedRelations) {
            violations.push({
              clause: lockingClause.clause,
              dynamicRelation: relation.value,
              grantedPrivileges: [],
              missingPrivileges: ['DYNAMIC_RELATION_ALLOWLIST'],
              relation: relation.display,
            })
            continue
          }

          for (const resolvedRelation of resolvedRelations) {
            if (!resolvedRelation.startsWith('mip_')) {
              continue
            }
            const grantedPrivileges = Array.isArray(privilegeMap?.[resolvedRelation])
              ? privilegeMap[resolvedRelation].map(value => String(value).toUpperCase())
              : []
            const missingPrivileges = []
            if (!grantedPrivileges.includes('SELECT')) {
              missingPrivileges.push('SELECT')
            }
            if (lockingClause.clause === 'FOR UPDATE'
              && !grantedPrivileges.some(value => FOR_UPDATE_PRIVILEGES.has(value))) {
              missingPrivileges.push('UPDATE|DELETE')
            }
            if (missingPrivileges.length) {
              violations.push({
                clause: lockingClause.clause,
                ...(relation.kind === 'dynamic' ? { dynamicRelation: relation.value } : {}),
                grantedPrivileges,
                missingPrivileges,
                relation: resolvedRelation,
              })
            }
          }
        }
      }
    }
  }
  return violations
}

function unsupportedLockingReadViolation(clause, missingPrivilege, relation) {
  return {
    clause,
    grantedPrivileges: [],
    missingPrivileges: [missingPrivilege],
    relation,
  }
}

function selectLockingReadRelations(relations, lockingClause, allowedDynamicRelations, violations) {
  if (!lockingClause.lockAliases) {
    return relations
  }
  const selected = new Set()
  for (const alias of lockingClause.lockAliases) {
    const matches = relations.filter(relation => lockingReadRelationHasAlias(
      relation,
      alias,
      allowedDynamicRelations,
    ))
    if (matches.length === 0) {
      violations.push(unsupportedLockingReadViolation(
        lockingClause.clause,
        'LOCKING_READ_ALIAS',
        `OF ${alias}`,
      ))
    }
    for (const relation of matches) {
      selected.add(relation)
    }
  }
  return [...selected]
}

function lockingReadRelationHasAlias(relation, alias, allowedDynamicRelations) {
  if (relation.alias === alias || (relation.kind === 'static' && relation.value === alias)) {
    return true
  }
  if (relation.kind !== 'dynamic' || relation.simpleIdentifier !== true) {
    return false
  }
  const allowed = allowedDynamicRelations?.[relation.value]
  return Array.isArray(allowed) && allowed.includes(alias)
}

function resolveLockingReadRelations(relation, allowedDynamicRelations) {
  if (relation.kind === 'static') {
    return [relation.value]
  }
  if (relation.simpleIdentifier !== true) {
    return null
  }
  const allowed = allowedDynamicRelations?.[relation.value]
  if (!Array.isArray(allowed)
    || allowed.length === 0
    || allowed.some(table => typeof table !== 'string' || !/^mip_[a-z0-9_]+$/.test(table))) {
    return null
  }
  return [...new Set(allowed)]
}

function lockingReadQueryBlocks(source) {
  const tokens = tokenizeLockingReadSql(source)
  const activeBlocks = new Map()
  const blocks = []
  let depth = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === '(') {
      const block = nearestActiveQueryBlock(activeBlocks, depth)
      if (block?.expectRelation && ['SELECT', 'WITH'].includes(tokens[index + 1]?.upper)) {
        addUnsupportedQueryShape(block, 'LOCKING_READ_DERIVED_RELATION', '<derived-relation>')
        block.expectRelation = false
      }
      depth += 1
      continue
    }
    if (token.value === ')') {
      activeBlocks.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }
    if (token.upper === 'SELECT') {
      const block = {
        depth,
        expectRelation: false,
        inFromClause: false,
        inJoinCondition: false,
        lockingClauses: [],
        relations: [],
        unsupported: new Map(),
      }
      activeBlocks.set(depth, block)
      blocks.push(block)
      continue
    }

    const block = nearestActiveQueryBlock(activeBlocks, depth)
    if (!block) {
      continue
    }
    const lockingClause = parseLockingReadClause(tokens, index)
    if (lockingClause) {
      block.lockingClauses.push(lockingClause)
      block.inFromClause = false
      block.inJoinCondition = false
      block.expectRelation = false
      index = lockingClause.endIndex
      continue
    }
    const isJoin = ['JOIN', 'STRAIGHT_JOIN'].includes(token.upper)
    if (token.upper === 'FROM' || (isJoin && block.inFromClause)) {
      block.inFromClause = true
      block.inJoinCondition = false
      block.expectRelation = true
      continue
    }
    if (block.inFromClause && ['ON', 'USING'].includes(token.upper)) {
      block.inJoinCondition = true
      block.expectRelation = false
      continue
    }
    if (FROM_CLAUSE_END.has(token.upper)) {
      block.inFromClause = false
      block.inJoinCondition = false
      block.expectRelation = false
      continue
    }
    if (block.expectRelation) {
      const relation = directRelationAt(tokens, index)
      if (relation) {
        block.relations.push(relation)
        index = relation.endIndex
      }
      else {
        addUnsupportedQueryShape(block, 'LOCKING_READ_RELATION', token.value)
      }
      block.expectRelation = false
      continue
    }
    if (block.inFromClause && !block.inJoinCondition && token.value === ',') {
      block.expectRelation = true
    }
  }

  const lockingBlocks = blocks.filter(block => block.lockingClauses.length > 0)
  if (tokens.some(token => token.upper === 'WITH')) {
    for (const block of lockingBlocks) {
      addUnsupportedQueryShape(block, 'LOCKING_READ_CTE', '<cte>')
    }
  }
  return lockingBlocks
}

function nearestActiveQueryBlock(activeBlocks, depth) {
  for (let candidateDepth = depth; candidateDepth >= 0; candidateDepth -= 1) {
    const block = activeBlocks.get(candidateDepth)
    if (block) {
      return block
    }
  }
  return null
}

function addUnsupportedQueryShape(block, missingPrivilege, relation) {
  block.unsupported.set(`${missingPrivilege}:${relation}`, { missingPrivilege, relation })
}

function parseLockingReadClause(tokens, index) {
  const token = tokens[index]
  const next = tokens[index + 1]
  let clause = null
  let endIndex = index
  if (token.upper === 'FOR' && ['SHARE', 'UPDATE'].includes(next?.upper)) {
    clause = `FOR ${next.upper}`
    endIndex = index + 1
  }
  else if (token.upper === 'LOCK'
    && next?.upper === 'IN'
    && tokens[index + 2]?.upper === 'SHARE'
    && tokens[index + 3]?.upper === 'MODE') {
    return {
      clause: 'LOCK IN SHARE MODE',
      endIndex: index + 3,
      lockAliases: null,
      unsupportedAlias: null,
    }
  }
  else {
    return null
  }

  if (tokens[endIndex + 1]?.upper !== 'OF') {
    return { clause, endIndex, lockAliases: null, unsupportedAlias: null }
  }
  const lockAliases = []
  let cursor = endIndex + 2
  let expectAlias = true
  while (cursor < tokens.length) {
    const aliasToken = tokens[cursor]
    if (expectAlias) {
      if (aliasToken?.kind !== 'word') {
        return {
          clause,
          endIndex: Math.max(endIndex + 1, cursor),
          lockAliases,
          unsupportedAlias: `OF ${aliasToken?.value || '<missing>'}`,
        }
      }
      lockAliases.push(aliasToken.value.toLowerCase())
      endIndex = cursor
      expectAlias = false
      cursor += 1
      continue
    }
    if (tokens[cursor]?.value !== ',') {
      break
    }
    expectAlias = true
    endIndex = cursor
    cursor += 1
  }
  return {
    clause,
    endIndex,
    lockAliases,
    unsupportedAlias: expectAlias ? 'OF <missing>' : null,
  }
}

function directRelationAt(tokens, index) {
  const first = tokens[index]
  if (!first || !['dynamic', 'word'].includes(first.kind)) {
    return null
  }
  let relation = null
  if (tokens[index + 1]?.value === '.') {
    const qualifiedRelation = tokens[index + 2]
    if (!qualifiedRelation || !['dynamic', 'word'].includes(qualifiedRelation.kind)) {
      return null
    }
    if (first.kind === 'dynamic' || qualifiedRelation.kind === 'dynamic') {
      relation = {
        endIndex: index + 2,
        display: `${first.kind === 'dynamic' ? `\${${first.value}}` : first.value}.${qualifiedRelation.kind === 'dynamic' ? `\${${qualifiedRelation.value}}` : qualifiedRelation.value}`,
        kind: 'dynamic',
        simpleIdentifier: false,
        startIndex: index,
        value: `${first.value}.${qualifiedRelation.value}`,
      }
    }
    else {
      relation = {
        endIndex: index + 2,
        display: `${first.value}.${qualifiedRelation.value}`,
        kind: 'static',
        startIndex: index,
        value: qualifiedRelation.value.toLowerCase(),
      }
    }
  }
  else if (first.kind === 'dynamic') {
    relation = {
      endIndex: index,
      display: `\${${first.value}}`,
      kind: 'dynamic',
      simpleIdentifier: first.simpleIdentifier,
      startIndex: index,
      value: first.value,
    }
  }
  else {
    relation = {
      endIndex: index,
      display: first.value,
      kind: 'static',
      startIndex: index,
      value: first.value.toLowerCase(),
    }
  }
  return attachLockingReadRelationAlias(tokens, relation)
}

function attachLockingReadRelationAlias(tokens, relation) {
  let cursor = relation.endIndex + 1
  if (tokens[cursor]?.upper === 'AS') {
    cursor += 1
    if (tokens[cursor]?.kind === 'word') {
      return { ...relation, alias: tokens[cursor].value.toLowerCase(), endIndex: cursor }
    }
    return relation
  }
  if (tokens[cursor]?.kind === 'word' && !RELATION_ALIAS_STOP.has(tokens[cursor].upper)) {
    return { ...relation, alias: tokens[cursor].value.toLowerCase(), endIndex: cursor }
  }
  return relation
}

function tokenizeLockingReadSql(source, options = {}) {
  const tokens = []
  let cursor = 0

  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (/\s/.test(char)) {
      cursor += 1
      continue
    }
    if (isMysqlDashCommentStart(source, cursor) || char === '#') {
      const lineEnd = source.indexOf('\n', cursor + 2)
      cursor = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }
    if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', cursor + 2)
      cursor = commentEnd === -1 ? source.length : commentEnd + 2
      continue
    }
    if (char === '\'' || char === '"') {
      const quoted = readQuotedSqlValue(source, cursor, char)
      cursor = quoted.end
      continue
    }
    if (char === '`') {
      const identifier = readQuotedSqlIdentifier(source, cursor)
      if (identifier) {
        tokens.push(sqlWord(identifier.value))
        cursor = identifier.end
        continue
      }
    }
    if (char === '$' && next === '{') {
      const expression = readDynamicTemplateExpression(source, cursor)
      tokens.push({
        kind: 'dynamic',
        simpleIdentifier: expression.simpleIdentifier,
        upper: expression.value.toUpperCase(),
        value: expression.value,
      })
      if (options.expandDynamicLocks !== false) {
        for (const dynamicLock of dynamicLockingReadFragments(expression.value)) {
          tokens.push(...tokenizeLockingReadSql(dynamicLock))
        }
      }
      cursor = expression.end
      continue
    }
    if (/[a-z_$]/i.test(char)) {
      let wordEnd = cursor + 1
      while (/[\w$]/.test(source[wordEnd] || '')
        && !(source[wordEnd] === '$' && source[wordEnd + 1] === '{')) {
        wordEnd += 1
      }
      tokens.push(sqlWord(source.slice(cursor, wordEnd)))
      cursor = wordEnd
      continue
    }
    if ('(),.;'.includes(char)) {
      tokens.push({ kind: 'symbol', upper: char, value: char })
    }
    cursor += 1
  }
  return tokens
}

function dynamicLockingReadFragments(expression) {
  return extractJavaScriptStrings(expression)
    .map(normalizeJavaScriptEscapes)
    .filter(fragment => lockingReadClauseIn(fragment))
}

function lockingReadClauseIn(source) {
  return lockingReadFragmentIn(source)?.clause || null
}

function lockingReadFragmentIn(source) {
  for (const [clause, pattern] of [
    ['FOR UPDATE', /\bFOR\s+UPDATE\b/i],
    ['FOR SHARE', /\bFOR\s+SHARE\b/i],
    ['LOCK IN SHARE MODE', /\bLOCK\s+IN\s+SHARE\s+MODE\b/i],
  ]) {
    const match = pattern.exec(source)
    if (match) {
      return { clause, sql: source.slice(match.index) }
    }
  }
  return null
}

function normalizeJavaScriptEscapes(source) {
  return String(source || '')
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (match, hex) => unicodeEscapeValue(match, hex))
    .replace(/\\u([0-9a-f]{4})/gi, (match, hex) => unicodeEscapeValue(match, hex))
    .replace(/\\x([0-9a-f]{2})/gi, (match, hex) => unicodeEscapeValue(match, hex))
    .replace(/\\([tnrfv])/g, (match, escape) => ({
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
    })[escape] || match)
}

function unicodeEscapeValue(fallback, hex) {
  const codePoint = Number.parseInt(hex, 16)
  return Number.isSafeInteger(codePoint) && codePoint <= 0x10FFFF
    ? String.fromCodePoint(codePoint)
    : fallback
}

function sqlWord(value) {
  return { kind: 'word', upper: value.toUpperCase(), value }
}

function readQuotedSqlValue(source, start, quote) {
  let value = ''
  let cursor = start + 1
  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (char === '\\') {
      value += next || ''
      cursor += 2
    }
    else if (char === quote && next === quote) {
      value += quote
      cursor += 2
    }
    else if (char === quote) {
      return { end: cursor + 1, value }
    }
    else {
      value += char
      cursor += 1
    }
  }
  return { end: source.length, value }
}

function readQuotedSqlIdentifier(source, start) {
  let value = ''
  let cursor = start + 1
  while (cursor < source.length) {
    const char = source[cursor]
    const next = source[cursor + 1]
    if (char === '`' && next === '`') {
      value += '`'
      cursor += 2
    }
    else if (char === '`') {
      return { end: cursor + 1, value }
    }
    else {
      value += char
      cursor += 1
    }
  }
  return null
}
