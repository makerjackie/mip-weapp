export function adminAssetRoute(routes, domain, functionName) {
  const root = routes.find(route => route.Domain === domain && route.Path === '/')
  if (!root || !(root.UpstreamResourceName === functionName || (root.UpstreamResourceType === 'STATIC_STORE' && root.PathRewrite?.StaticStorePrefix === '/mip-admin-console'))) {
    throw new Error('Admin root ownership required before installing asset route')
  }
  const assetRoutes = routes.filter(route => route.Domain === domain && (route.Path === '/assets' || route.Path.startsWith('/assets/')))
  if (assetRoutes.some(route => route.UpstreamResourceName !== functionName || route.UpstreamResourceType !== 'SCF')) {
    throw new Error('Asset route belongs to another application')
  }
  return { action: assetRoutes.some(route => route.Path === '/assets') ? 'updateRoute' : 'createRoute', targetName: functionName, path: '/assets', domain, upstreamResourceType: 'SCF', auth: false, enablePathTransmission: true }
}
