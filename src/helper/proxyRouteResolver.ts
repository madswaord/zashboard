import { fetchGeoPoint, type GeoPoint } from '@/api/geoip-map'
import { proxyMap } from '@/store/proxies'
import type { Connection, Proxy } from '@/types'

const serverCache = new Map<string, string | null>()

const getProxyServer = (proxy: Proxy | undefined): string | null => {
  if (!proxy) return null

  const anyProxy = proxy as Proxy & Record<string, unknown>
  const candidates = [
    anyProxy.server,
    anyProxy.address,
    anyProxy.host,
    anyProxy.realIP,
    anyProxy.realIp,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

const isIPv4 = (value: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
const isIPv6 = (value: string) => value.includes(':')

const resolveDomainToIP = async (domain: string): Promise<string | null> => {
  if (serverCache.has(domain)) return serverCache.get(domain) || null

  try {
    const response = await fetch(
      `https://dns.alidns.com/resolve?name=${encodeURIComponent(domain)}&type=A`,
    )
    const data = await response.json()
    const answer = Array.isArray(data.Answer)
      ? data.Answer.find((item: { data?: string }) => item?.data)
      : null
    const ip = typeof answer?.data === 'string' ? answer.data : null
    serverCache.set(domain, ip)
    return ip
  } catch {
    serverCache.set(domain, null)
    return null
  }
}

export const getFinalOutboundName = (connection: Connection) => {
  const name = connection.chains?.[0]
  if (!name) return null

  let node = proxyMap.value[name]
  if (!node) return name

  const seen = new Set<string>()
  while (node?.now && node.now !== node.name && !seen.has(node.name)) {
    seen.add(node.name)
    const next = proxyMap.value[node.now]
    if (!next) return node.now
    node = next
  }

  return node?.name || name
}

export const resolveProxyHopGeoPoint = async (connection: Connection): Promise<GeoPoint | null> => {
  const finalName = getFinalOutboundName(connection)
  if (!finalName) return null

  const proxy = proxyMap.value[finalName]
  const server = getProxyServer(proxy)
  if (!server) return null

  const ip = isIPv4(server) || isIPv6(server) ? server : await resolveDomainToIP(server)
  if (!ip) return null

  return await fetchGeoPoint(ip)
}
