import { getIPFromIpipnetAPI } from '@/api/geoip'
import { fetchGeoPoint, type GeoPoint } from '@/api/geoip-map'
import { latToAtlanticSvgY, lonToAtlanticSvgX } from '@/composables/svgCalibration'
import { getFinalOutboundName, resolveProxyHopGeoPoint } from '@/helper/proxyRouteResolver'
import { activeConnections } from '@/store/connections'
import type { Connection } from '@/types'

export interface SvgPoint {
  x: number
  y: number
}

export interface SvgTrafficPoint {
  ip: string
  geo: GeoPoint
  svg: SvgPoint
  label: string
}

export interface SvgTrafficRoute {
  id: string
  host: string
  connection: Connection
  source: SvgTrafficPoint
  destination: SvgTrafficPoint
  proxy?: SvgTrafficPoint | null
  finalOutboundName: string | null
}

export const geoToSvgPoint = (geo: GeoPoint): SvgPoint => ({
  x: lonToAtlanticSvgX(geo.longitude),
  y: latToAtlanticSvgY(geo.latitude),
})

export const resolveEgressPoint = async (): Promise<SvgTrafficPoint | null> => {
  const ipip = await getIPFromIpipnetAPI()
  const ip = ipip?.data?.ip
  if (!ip) return null
  const geo = await fetchGeoPoint(ip)
  if (!geo) return null
  return {
    ip,
    geo,
    svg: geoToSvgPoint(geo),
    label: 'Egress',
  }
}

export const resolveSvgTrafficRoutes = async (limit = 80): Promise<SvgTrafficRoute[]> => {
  const egress = await resolveEgressPoint()
  if (!egress) return []

  const routes: SvgTrafficRoute[] = []
  for (const conn of activeConnections.value.slice(0, limit)) {
    try {
      const destinationGeo = await fetchGeoPoint(conn.metadata.destinationIP)
      if (!destinationGeo) continue
      const destination: SvgTrafficPoint = {
        ip: conn.metadata.destinationIP,
        geo: destinationGeo,
        svg: geoToSvgPoint(destinationGeo),
        label: conn.metadata.host || conn.metadata.sniffHost || conn.metadata.destinationIP,
      }

      let proxyPoint: SvgTrafficPoint | null = null
      try {
        const proxyGeo = await resolveProxyHopGeoPoint(conn)
        if (proxyGeo) {
          proxyPoint = {
            ip: proxyGeo.ip,
            geo: proxyGeo,
            svg: geoToSvgPoint(proxyGeo),
            label: getFinalOutboundName(conn) || 'Proxy',
          }
        }
      } catch {
        proxyPoint = null
      }

      routes.push({
        id: conn.id,
        host: destination.label,
        connection: conn,
        source: egress,
        destination,
        proxy: proxyPoint,
        finalOutboundName: getFinalOutboundName(conn),
      })
    } catch {
      continue
    }
  }

  return routes
}
