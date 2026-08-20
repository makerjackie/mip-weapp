function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function pathValue(value, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], value)
}

export function normalizeRuntimeQuery(query) {
  if (!query) {
    return ''
  }
  if (typeof query === 'string') {
    return query.replace(/^\?/, '').trim()
  }
  invariant(typeof query === 'object' && !Array.isArray(query), 'Runtime page query must be a string or object')
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      parameters.set(key, String(value))
    }
  }
  return parameters.toString()
}

export function normalizeRuntimePageConfig(config) {
  invariant(Array.isArray(config?.pages) && config.pages.length > 0, 'Runtime page config needs at least one page')
  return config.pages.map((specification) => {
    const route = specification.route || specification.path
    const selector = specification.selector || specification.rootSelector
    const allowedStates = specification.states
      || specification.acceptStates
      || specification.allowedStates
    const stateField = specification.stateField || config.stateField || 'state'
    invariant(typeof route === 'string' && route.length > 0, 'Runtime page config entry needs route or path')
    invariant(typeof selector === 'string' && selector.length > 0, `${route} needs selector or rootSelector`)
    return {
      id: specification.id || route,
      route,
      expectedRoute: specification.expectedRoute || route,
      query: normalizeRuntimeQuery(specification.query),
      selector,
      secondarySelector: specification.secondarySelector || specification.readySelector,
      assertData(data) {
        if (Array.isArray(allowedStates)) {
          const state = pathValue(data, stateField)
          invariant(
            allowedStates.includes(state),
            `${route} did not settle in an allowed ${stateField} state (received ${String(state)})`,
          )
        }
        for (const check of specification.checks || []) {
          const value = pathValue(data, check.path)
          if (typeof check.equals !== 'undefined') {
            invariant(value === check.equals, `${route} expected ${check.path}=${check.equals}`)
          }
          if (typeof check.minLength === 'number') {
            invariant(
              (Array.isArray(value) || typeof value === 'string') && value.length >= check.minLength,
              `${route} expected ${check.path} length >= ${check.minLength}`,
            )
          }
          if (check.truthy === true) {
            invariant(Boolean(value), `${route} expected ${check.path} to be truthy`)
          }
          if (check.falsy === true) {
            invariant(!value, `${route} expected ${check.path} to be falsy`)
          }
        }
      },
    }
  })
}

export function runtimePagePath(pageCase) {
  return `/${pageCase.route}${pageCase.query ? `?${pageCase.query}` : ''}`
}

export function runtimeOutputName(pageCase) {
  return runtimePagePath(pageCase).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
}
