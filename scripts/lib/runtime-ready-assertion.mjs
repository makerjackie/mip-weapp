function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function pathValue(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], value)
}

function parseClause(source, label) {
  const equality = /^([a-z]\w*(?:\.[a-z]\w*)*)\s*===\s*'([\w-]+)'$/i.exec(source)
  if (equality) {
    return { path: equality[1], values: [equality[2]] }
  }

  const membership = /^([a-z]\w*(?:\.[a-z]\w*)*)\s+in\s+([\w-]+(?:\|[\w-]+)*)$/i.exec(source)
  invariant(membership, `${label} uses unsupported readyAssertion syntax: ${source}`)
  return { path: membership[1], values: membership[2].split('|') }
}

export function parseReadyAssertion(source, label = 'runtime route') {
  invariant(typeof source === 'string' && source.trim(), `${label} readyAssertion must be a non-empty string`)
  const clauses = source.split('||').map(clause => parseClause(clause.trim(), label))
  invariant(clauses.length > 0, `${label} readyAssertion needs at least one clause`)
  return clauses
}

export function assertReadyAssertion(data, source, label = 'runtime route') {
  const clauses = parseReadyAssertion(source, label)
  if (clauses.some(clause => clause.values.includes(String(pathValue(data, clause.path))))) {
    return
  }
  const received = clauses.map(clause => `${clause.path}=${String(pathValue(data, clause.path))}`).join(', ')
  throw new Error(`${label} failed readyAssertion "${source}" (${received})`)
}
