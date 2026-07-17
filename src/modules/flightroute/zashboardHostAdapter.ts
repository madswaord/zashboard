import { getIPFromIpipnetAPI } from '@/api/geoip'
import {
  getConnectionDownload,
  getConnectionHostname,
  getConnectionUpload,
  getDestinationFromConnection,
} from '@/helper'
import { activeConnections } from '@/store/connections'
import type { Connection } from '@/types'
import type { FlightRouteHostAdapter, TrafficConnectionLike } from 'flightroute/render'
import { fetchGeoPoint } from './geo'
import { getFinalOutboundName, resolveProxyHopGeoPoint } from './proxyRoute'

const EGRESS_CACHE_TTL = 1000 * 60 * 30
const EGRESS_ERROR_CACHE_TTL = 1000 * 60
const EGRESS_REQUEST_TIMEOUT = 8000
let egressCache: { ip: string | null; expiresAt: number } | null = null
let pendingEgress: Promise<string | null> | null = null
let cachedConnectionSource: Connection[] | null = null
let cachedSortedConnections: Connection[] = []

const fetchFallbackEgressIp = async () => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), EGRESS_REQUEST_TIMEOUT)

  try {
    const response = await fetch(`https://ipwho.is/?t=${Date.now()}`, {
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = (await response.json()) as { ip?: string; success?: boolean }
    return data.success === false ? null : data.ip || null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const fetchPrimaryEgressIp = async () => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), EGRESS_REQUEST_TIMEOUT)

  try {
    const response = await getIPFromIpipnetAPI(controller.signal)
    return response?.data?.ip || null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const resolveEgressIp = async () => {
  if (egressCache && egressCache.expiresAt > Date.now()) {
    return egressCache.ip
  }

  if (pendingEgress) {
    return pendingEgress
  }

  pendingEgress = (async () => {
    return (await fetchPrimaryEgressIp()) || (await fetchFallbackEgressIp())
  })()
    .then((ip) => {
      egressCache = {
        ip,
        expiresAt: Date.now() + (ip ? EGRESS_CACHE_TTL : EGRESS_ERROR_CACHE_TTL),
      }
      return ip
    })
    .finally(() => {
      pendingEgress = null
    })

  return pendingEgress
}

const toTrafficConnection = (connection: Connection): TrafficConnectionLike => {
  const destination = getDestinationFromConnection(connection)

  return {
    id: connection.id,
    host: getConnectionHostname(connection) || destination,
    destinationIP: destination,
    download: getConnectionDownload(connection),
    upload: getConnectionUpload(connection),
    downloadSpeed: connection.downloadSpeed,
    uploadSpeed: connection.uploadSpeed,
    raw: connection,
  }
}

const toRawConnection = (connection: TrafficConnectionLike) => {
  return connection.raw as Connection | undefined
}

export const getFlightRouteConnectionSnapshot = (limit: number) => {
  const source = activeConnections.value
  if (source !== cachedConnectionSource) {
    cachedConnectionSource = source
    cachedSortedConnections = [...source].sort(
      (a, b) => b.downloadSpeed + b.uploadSpeed - (a.downloadSpeed + a.uploadSpeed),
    )
  }

  return cachedSortedConnections.slice(0, limit).map(toTrafficConnection)
}

export const zashboardFlightRouteHost: FlightRouteHostAdapter = {
  getEgressIp: resolveEgressIp,
  fetchGeoPoint,
  async listConnections(limit) {
    return getFlightRouteConnectionSnapshot(limit)
  },
  async resolveProxyHopGeoPoint(connection) {
    const rawConnection = toRawConnection(connection)
    if (!rawConnection) {
      return null
    }

    return await resolveProxyHopGeoPoint(rawConnection)
  },
  getFinalOutboundName(connection) {
    const rawConnection = toRawConnection(connection)
    if (!rawConnection) {
      return null
    }

    return getFinalOutboundName(rawConnection)
  },
}
