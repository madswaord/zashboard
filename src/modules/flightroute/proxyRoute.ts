import { connectionAccessor } from '@/assembly/connections'
import { proxyMap } from '@/assembly/proxies'
import type { Connection, Proxy } from '@/types'
import { fetchGeoPoint, type GeoPoint } from './geo'

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

export const getFinalOutboundName = (connection: Connection) => {
  const name = connectionAccessor().chains(connection)[0]
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

  return await fetchGeoPoint(server)
}
