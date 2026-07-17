import type { GeoPoint } from 'flightroute/render'
import { latToAtlanticSvgY, lonToAtlanticSvgX, resolveSvgTrafficRoutes } from 'flightroute/render'
import { zashboardFlightRouteHost } from './zashboardHostAdapter'

const geoToSvgPoint = (geo: GeoPoint) => ({
  x: lonToAtlanticSvgX(geo.longitude),
  y: latToAtlanticSvgY(geo.latitude),
})

export const resolveZashboardSvgTrafficRoutes = (limit = 80) => {
  return resolveSvgTrafficRoutes(
    {
      geoToSvgPoint,
      host: zashboardFlightRouteHost,
    },
    limit,
  )
}
