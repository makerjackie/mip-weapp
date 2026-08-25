function invariant(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export function buildDevtoolsConditionRoutes(routes) {
  invariant(Array.isArray(routes) && routes.length > 0, 'DevTools routes must be a non-empty array')
  return routes.map((route) => {
    invariant(typeof route?.name === 'string' && route.name.trim(), 'DevTools route name is required')
    invariant(typeof route?.pathName === 'string' && route.pathName.trim(), 'DevTools route pathName is required')
    return {
      name: route.name,
      pathName: route.pathName,
      query: route.query || '',
      scene: null,
    }
  })
}

export function buildDevtoolsPrivateConfig(options) {
  const {
    appid,
    existing = {},
    projectName,
    routes,
  } = options
  return {
    ...existing,
    appid,
    projectname: projectName,
    setting: { ...existing.setting, compileHotReLoad: true },
    condition: {
      ...existing.condition,
      miniprogram: {
        ...existing.condition?.miniprogram,
        list: buildDevtoolsConditionRoutes(routes),
      },
    },
    libVersion: '3.15.2',
  }
}
