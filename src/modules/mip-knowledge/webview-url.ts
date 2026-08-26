const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/

function exactAllowedHosts(values: readonly string[]) {
  const hosts = new Set<string>()
  for (const value of values) {
    const host = value.trim().toLowerCase()
    if (!host || ipv4Pattern.test(host) || !hostnamePattern.test(host)) {
      return null
    }
    hosts.add(host)
  }
  return hosts.size ? hosts : null
}

export function resolveKnowledgeWebviewUrl(value: unknown, allowedHostValues: readonly string[]) {
  if (typeof value !== 'string' || !value.trim()) {
    return ''
  }
  const allowedHosts = exactAllowedHosts(allowedHostValues)
  if (!allowedHosts) {
    return ''
  }
  try {
    const parsed = new URL(value.trim())
    const hostname = parsed.hostname.toLowerCase()
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hash
      || ipv4Pattern.test(hostname) || !hostnamePattern.test(hostname)
      || !allowedHosts.has(hostname) || parsed.search.length > 512
      || Array.from(parsed.searchParams).length > 20
      || Array.from(parsed.searchParams).some(([key, parameter]) => key.length > 64 || parameter.length > 256)) {
      return ''
    }
    return parsed.toString()
  }
  catch {
    return ''
  }
}
