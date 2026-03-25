import { fetchGeoPoint, type GeoPoint } from '@/api/geoip-map'
import { fetchPublicIP } from '@/api/public-ip'
import { getFinalOutboundName, resolveProxyHopGeoPoint } from '@/helper/proxyRouteResolver'
import { activeConnections } from '@/store/connections'
import { activeBackend } from '@/store/setup'
import { computed, ref, watch, type WatchStopHandle } from 'vue'

export interface WorldTrafficRoute {
  id: string
  host: string
  destinationIP: string
  rule: string
  chains: string[]
  source: GeoPoint | null
  proxy: GeoPoint | null
  destination: GeoPoint | null
  finalOutboundName: string | null
  alive: boolean
  updatedAt: number
}

export const publicEgress = ref<GeoPoint | null>(null)
export const worldTrafficRoutes = ref<Record<string, WorldTrafficRoute>>({})
export const worldTrafficReady = ref(false)
export const worldTrafficError = ref('')

const hydrationMap = new Map<string, Promise<void>>()
let stopWorldTrafficWatch: WatchStopHandle | null = null

const refreshPublicEgress = async () => {
  try {
    const publicIP = await fetchPublicIP()
    const geo = await fetchGeoPoint(publicIP.ip)

    if (geo) {
      publicEgress.value = {
        ...geo,
        source: publicIP.source,
      }
      worldTrafficError.value = ''
      return
    }

    worldTrafficError.value = `本机公网 IP 获取成功（${publicIP.source}: ${publicIP.ip}），但地理定位失败`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    worldTrafficError.value = `本机公网 IP 获取失败：${message}`
    publicEgress.value = null
  }
}

const buildBaseRoute = (
  connection: (typeof activeConnections.value)[number],
): WorldTrafficRoute => {
  const destinationIP = connection.metadata.destinationIP
  return {
    id: connection.id,
    host: connection.metadata.host || connection.metadata.sniffHost || destinationIP,
    destinationIP,
    rule: connection.rulePayload
      ? `${connection.rule}: ${connection.rulePayload}`
      : connection.rule,
    chains: connection.chains || [],
    source: publicEgress.value,
    proxy: null,
    destination: null,
    finalOutboundName: getFinalOutboundName(connection),
    alive: true,
    updatedAt: Date.now(),
  }
}

const hydrateRoute = async (connection: (typeof activeConnections.value)[number]) => {
  if (hydrationMap.has(connection.id)) {
    return hydrationMap.get(connection.id)
  }

  const promise = (async () => {
    const current = worldTrafficRoutes.value[connection.id] || buildBaseRoute(connection)
    current.source = publicEgress.value
    current.finalOutboundName = getFinalOutboundName(connection)

    if (!current.destination) {
      try {
        current.destination = await fetchGeoPoint(connection.metadata.destinationIP)
      } catch {
        current.destination = null
      }
    }

    try {
      current.proxy = await resolveProxyHopGeoPoint(connection)
    } catch {
      current.proxy = null
    }
    current.alive = true
    current.updatedAt = Date.now()
    worldTrafficRoutes.value = {
      ...worldTrafficRoutes.value,
      [connection.id]: current,
    }
  })().finally(() => {
    hydrationMap.delete(connection.id)
  })

  hydrationMap.set(connection.id, promise)
  return promise
}

export const initWorldTrafficMap = () => {
  worldTrafficReady.value = false
  worldTrafficError.value = ''
  worldTrafficRoutes.value = {}
  stopWorldTrafficWatch?.()

  refreshPublicEgress().finally(() => {
    worldTrafficReady.value = true
  })

  stopWorldTrafficWatch = watch(
    [activeConnections, publicEgress, activeBackend],
    () => {
      const activeIds = new Set(activeConnections.value.map((connection) => connection.id))
      const next: Record<string, WorldTrafficRoute> = {}

      Object.values(worldTrafficRoutes.value).forEach((route) => {
        if (activeIds.has(route.id)) {
          next[route.id] = {
            ...route,
            alive: true,
            source: publicEgress.value,
            updatedAt: Date.now(),
          }
        }
      })

      activeConnections.value.forEach((connection) => {
        next[connection.id] = next[connection.id] || buildBaseRoute(connection)
        void hydrateRoute(connection)
      })

      worldTrafficRoutes.value = next
    },
    {
      immediate: true,
      deep: true,
    },
  )
}

export const worldTrafficList = computed(() => {
  return Object.values(worldTrafficRoutes.value).filter((route) => route.destination)
})
