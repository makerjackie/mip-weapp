// Provisioned concurrency belongs to an immutable numbered version. Keep the
// default alias moving with deployments, or later fixes would remain on $LATEST.
export async function releaseProvisionedFunction({ call, functionName, namespace, instances, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const params = { FunctionName: functionName, Namespace: namespace }
  const invoke = async (action, extra = {}) => {
    const result = await call(action, { ...params, ...extra })
    if (result?.success === false || result?.isError || result?.Error || result?.Response?.Error) {
      throw new Error(`${functionName}: ${action} rejected`)
    }
    return result
  }
  const aliases = await invoke('ListAliases')
  const previous = aliases.Aliases?.find(alias => alias.Name === '$DEFAULT')
  const config = await invoke('GetProvisionedConcurrencyConfig')
  const active = config.Allocated?.find(item => item.Qualifier === previous?.FunctionVersion)
  const count = instances ?? active?.AllocatedProvisionedConcurrencyNum ?? 0
  if (!count) {
    return null
  }
  if (!previous || !Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('Invalid provisioned release target')
  }
  if (Object.values(previous.RoutingConfig || {}).some(value => Array.isArray(value) && value.length)) {
    throw new Error('Existing traffic split requires an explicit release plan')
  }
  const published = await invoke('PublishVersion', { Description: 'Warm instance release' })
  const version = published.FunctionVersion
  if (!/^\d+$/.test(version || '')) {
    throw new Error('Numbered function version not returned')
  }
  let versionReady = false
  for (let attempt = 0; attempt < 45; attempt++) {
    const detail = await invoke('GetFunction', { Qualifier: version, ShowCode: 'FALSE' })
    if (detail.Status === 'Active') {
      versionReady = true
      break
    }
    if (/failed|error/i.test(detail.Status || '')) {
      throw new Error('Published function version failed')
    }
    await wait(2000)
  }
  if (!versionReady) {
    throw new Error('Published function version readiness timed out')
  }
  await invoke('PutProvisionedConcurrencyConfig', { Qualifier: version, VersionProvisionedConcurrencyNum: count })
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const current = await invoke('GetProvisionedConcurrencyConfig', { Qualifier: version })
    const allocation = current.Allocated?.find(item => item.Qualifier === version)
    if (allocation?.Status === 'Failed') {
      throw new Error(`${functionName}: provisioned instance failed`)
    }
    if (allocation?.Status === 'Done' && allocation.AvailableProvisionedConcurrencyNum >= count) {
      ready = true
      break
    }
    await wait(2000)
  }
  if (!ready) {
    throw new Error(`${functionName}: provisioned instance readiness timed out; traffic unchanged`)
  }
  // Refuse to overwrite another operator's release while instances were starting.
  const latestAliases = await invoke('ListAliases')
  const currentAlias = latestAliases.Aliases?.find(alias => alias.Name === '$DEFAULT')
  if (JSON.stringify(currentAlias) !== JSON.stringify(previous)) {
    throw new Error('Default alias changed during warm-up; traffic unchanged')
  }
  await invoke('UpdateAlias', { Name: '$DEFAULT', FunctionVersion: version, RoutingConfig: previous.RoutingConfig })
  const readback = await invoke('ListAliases')
  if (readback.Aliases?.find(alias => alias.Name === '$DEFAULT')?.FunctionVersion !== version) {
    throw new Error('Default alias readback failed')
  }
  // Remove only the superseded default's allocation, preserving other versions.
  if (active && previous.FunctionVersion !== version) {
    await invoke('DeleteProvisionedConcurrencyConfig', { Qualifier: previous.FunctionVersion })
  }
  return { functionName, version, instances: count, previousVersion: previous.FunctionVersion }
}
