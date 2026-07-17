<template>
  <section class="flight-route-card card">
    <header class="flight-route-header">
      <div class="min-w-0">
        <div class="flight-route-kicker">FlightRoute</div>
        <h2 class="flight-route-title">Global Route Matrix</h2>
      </div>

      <div
        class="flight-route-status"
        :class="hasRoutes ? 'flight-route-status-active' : 'flight-route-status-idle'"
        aria-live="polite"
      >
        <span class="flight-route-status-dot"></span>
        <span>{{ hasRoutes ? 'Live' : 'Idle' }}</span>
      </div>
    </header>

    <div class="flight-route-metrics">
      <div class="flight-route-metric">
        <span>Connections</span>
        <strong>{{ connectionCount }}</strong>
      </div>
      <div class="flight-route-metric">
        <span>Destinations</span>
        <strong>{{ destinationCount }}</strong>
      </div>
    </div>

    <div class="flight-route-body">
      <div class="flight-route-surface">
        <div
          ref="chartRef"
          class="flight-route-chart"
        ></div>

        <div
          v-if="!routeReady && !hasRoutes"
          class="flight-route-overlay"
        >
          <span class="loading loading-spinner loading-sm"></span>
        </div>
        <div
          v-else-if="worldTrafficError"
          class="flight-route-message flight-route-error"
          role="status"
        >
          {{ worldTrafficError }}
        </div>
        <div
          v-else-if="!hasRoutes"
          class="flight-route-overlay flight-route-empty"
        >
          No data
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { getConnectionDownload, getConnectionUpload, getDestinationFromConnection } from '@/helper'
import { resolveZashboardSvgTrafficRoutes } from '@/modules/flightroute/core'
import { activeConnections } from '@/store/connections'
import { useElementSize, watchDebounced } from '@vueuse/core'
import { EffectScatterChart, LinesChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { SvgTrafficRoute } from 'flightroute/render'
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'

echarts.use([
  GeoComponent,
  TooltipComponent,
  ScatterChart,
  EffectScatterChart,
  LinesChart,
  CanvasRenderer,
])

const chartRef = ref<HTMLDivElement>()
const routeReady = ref(false)
const worldTrafficError = ref('')
const hasRoutes = ref(false)
const destinationCount = ref(0)
const currentRoutes = shallowRef<SvgTrafficRoute[]>([])
const { width, height } = useElementSize(chartRef)

let chart: echarts.ECharts | null = null
let mapReady: Promise<void> | null = null
let mapRegistered = false
let refreshGeneration = 0
let refreshInFlight = false
let refreshQueued = false
let componentAlive = true

const SVG_WIDTH = 960
const SVG_CONTENT_RATIO = SVG_WIDTH / 462.94
const MAX_CONNECTIONS = 100
const FLOW_SIGNATURE_BUCKET = 1024 * 1024
const SPEED_SIGNATURE_BUCKET = 64 * 1024
type MapCoordinate = [number, number]

const isCompact = computed(() => width.value > 0 && width.value < 560)
const connectionCount = computed(() => activeConnections.value.length)
const connectionSignature = computed(() =>
  activeConnections.value
    .map((connection) => {
      const flow = getConnectionDownload(connection) + getConnectionUpload(connection)
      const speed = connection.downloadSpeed + connection.uploadSpeed
      return `${connection.id}:${getDestinationFromConnection(connection)}:${Math.floor(flow / FLOW_SIGNATURE_BUCKET)}:${Math.floor(speed / SPEED_SIGNATURE_BUCKET)}`
    })
    .join('|'),
)

const getRouteFlow = (route: SvgTrafficRoute) => {
  const hasSpeed =
    route.connection.downloadSpeed !== undefined || route.connection.uploadSpeed !== undefined
  if (hasSpeed) {
    return (route.connection.downloadSpeed || 0) + (route.connection.uploadSpeed || 0)
  }
  return route.connection.download + route.connection.upload
}

const ensureMap = () => {
  if (!mapReady) {
    mapReady = import('flightroute/assets/maps/world-atlantic.svg?raw')
      .then(({ default: svg }) => {
        echarts.registerMap('global-route-matrix', { svg })
        mapRegistered = true
      })
      .catch((error) => {
        mapReady = null
        mapRegistered = false
        throw error
      })
  }
  return mapReady
}

const getGeoLayout = () => {
  const sceneWidth = Math.max(width.value, 280)
  const sceneHeight = Math.max(height.value, 220)
  const horizontalPadding = isCompact.value ? 12 : 28
  const verticalPadding = isCompact.value ? 14 : 24
  const availableWidth = Math.max(240, sceneWidth - horizontalPadding * 2)
  const availableHeight = Math.max(180, sceneHeight - verticalPadding * 2)
  const mapWidth = Math.min(availableWidth, availableHeight * SVG_CONTENT_RATIO)

  return {
    layoutCenter: ['50%', '51%'],
    layoutSize: mapWidth,
  }
}

const getScatterSize = (value: number[]) => {
  const count = value[2] || 0
  const weight = value[3] || 0
  const flow = value[4] || 0
  const size = 5 + count * 1.25 + weight * 6 + Math.min(5, flow / (24 * 1024 * 1024))
  return isCompact.value ? Math.min(15, size * 0.8) : Math.min(24, size)
}

const getEffectScatterSize = (value: number[]) => {
  const count = value[2] || 0
  const weight = value[3] || 0
  const size = 8 + count * 1.4 + weight * 6
  return isCompact.value ? Math.min(17, size * 0.76) : Math.min(26, size)
}

const applyChartOptions = (routes: SvgTrafficRoute[]) => {
  if (!mapRegistered) return

  const scatterMap = new Map<
    string,
    { name: string; value: [number, number, number, number, number] }
  >()
  const lines: Array<{
    coords: MapCoordinate[]
    fromName: string
    toName: string
    host: string
    lineStyle: { curveness: number; width: number; opacity: number }
  }> = []

  const getLineSegments = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): MapCoordinate[] => {
    const deltaX = to.x - from.x
    if (Math.abs(deltaX) <= SVG_WIDTH / 2) {
      return [
        [from.x, from.y],
        [to.x, to.y],
      ]
    }

    const crossesRightEdge = deltaX < 0
    const adjustedToX = crossesRightEdge ? to.x + SVG_WIDTH : to.x - SVG_WIDTH
    const edgeX = crossesRightEdge ? SVG_WIDTH : 0
    const ratio = (edgeX - from.x) / (adjustedToX - from.x)
    const edgeY = from.y + (to.y - from.y) * ratio

    return crossesRightEdge
      ? [
          [from.x, from.y],
          [SVG_WIDTH, edgeY],
          [0, edgeY],
          [to.x, to.y],
        ]
      : [
          [from.x, from.y],
          [0, edgeY],
          [SVG_WIDTH, edgeY],
          [to.x, to.y],
        ]
  }

  const addPoint = (name: string, x: number, y: number, weight: number, flow: number) => {
    const key = `${name}-${x}-${y}`
    const current = scatterMap.get(key)
    if (current) {
      current.value[2] += 1
      current.value[3] = Math.max(current.value[3], weight)
      current.value[4] += flow
      return
    }
    scatterMap.set(key, { name, value: [x, y, 1, weight, flow] })
  }

  const addLine = (
    route: SvgTrafficRoute,
    from: { label: string; svg: { x: number; y: number } },
    to: { label: string; svg: { x: number; y: number } },
    segmentIndex: number,
  ) => {
    const flow = getRouteFlow(route)
    const weight = Math.min(1.4, Math.max(0.18, flow / (2 * 1024 * 1024)))
    const wrappedCoords = getLineSegments(from.svg, to.svg)
    const curveDirection = segmentIndex % 2 === 0 ? 1 : -1
    const coordinatePairs: MapCoordinate[][] =
      wrappedCoords.length === 2
        ? [wrappedCoords]
        : [wrappedCoords.slice(0, 2), wrappedCoords.slice(2, 4)]

    for (const coords of coordinatePairs) {
      const dx = coords[1][0] - coords[0][0]
      const dy = coords[1][1] - coords[0][1]
      const distance = Math.hypot(dx, dy)
      const curveness = curveDirection * Math.min(0.28, Math.max(0.08, Math.abs(dx) / 4800))

      lines.push({
        coords,
        fromName: from.label,
        toName: to.label,
        host: route.host,
        lineStyle: {
          curveness,
          width: Math.min(1.8, Math.max(0.65, distance / 1500 + weight * 0.8)),
          opacity: Math.min(0.62, Math.max(0.28, distance / 1800 + weight * 0.18)),
        },
      })
    }
  }

  for (const route of routes) {
    const flow = getRouteFlow(route)
    const weight = Math.min(1.4, Math.max(0.18, flow / (2 * 1024 * 1024)))
    addPoint(route.source.label, route.source.svg.x, route.source.svg.y, weight, flow)
    addPoint(
      route.destination.label,
      route.destination.svg.x,
      route.destination.svg.y,
      weight,
      flow,
    )

    if (route.proxy) {
      addPoint(route.proxy.label, route.proxy.svg.x, route.proxy.svg.y, weight, flow)
      addLine(route, route.source, route.proxy, 0)
      addLine(route, route.proxy, route.destination, 1)
    } else {
      addLine(route, route.source, route.destination, 0)
    }
  }

  chart?.setOption(
    {
      backgroundColor: 'transparent',
      animationDurationUpdate: 300,
      tooltip: {
        trigger: 'item',
        confine: true,
      },
      geo: {
        map: 'global-route-matrix',
        roam: false,
        silent: true,
        ...getGeoLayout(),
        itemStyle: {
          areaColor: 'rgba(148, 163, 184, 0.18)',
          borderColor: 'rgba(100, 116, 139, 0.48)',
          borderWidth: 1,
        },
        emphasis: {
          disabled: true,
        },
      },
      series: [
        {
          type: 'lines',
          coordinateSystem: 'geo',
          effect: {
            show: true,
            period: isCompact.value ? 3.4 : 2.8,
            trailLength: isCompact.value ? 0.32 : 0.46,
            symbolSize: isCompact.value ? 3 : 4,
          },
          lineStyle: {
            color: '#0ea5e9',
            width: 0.7,
            opacity: 0.34,
            curveness: 0.16,
          },
          data: lines,
        },
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          symbolSize: (value: number[]) => getScatterSize(value),
          itemStyle: { color: '#f97316', opacity: 0.9 },
          data: Array.from(scatterMap.values()),
        },
        {
          type: 'effectScatter',
          coordinateSystem: 'geo',
          rippleEffect: {
            scale: isCompact.value ? 1.8 : 2.5,
            brushType: 'stroke',
          },
          symbolSize: (value: number[]) => getEffectScatterSize(value),
          itemStyle: { color: '#fb923c', opacity: 0.95 },
          data: Array.from(scatterMap.values()).filter((item) => item.value[2] >= 2),
        },
      ],
    },
    { notMerge: true, lazyUpdate: true },
  )
}

const refreshRoutes = async () => {
  const generation = ++refreshGeneration
  if (!hasRoutes.value) routeReady.value = false
  worldTrafficError.value = ''

  try {
    await ensureMap()
    if (generation !== refreshGeneration) return
    applyChartOptions(currentRoutes.value)

    const routes = await resolveZashboardSvgTrafficRoutes(MAX_CONNECTIONS)
    if (generation !== refreshGeneration) return

    currentRoutes.value = routes
    destinationCount.value = new Set(routes.map((route) => route.destination.ip)).size
    hasRoutes.value = routes.length > 0
    applyChartOptions(routes)
  } catch (error) {
    if (generation !== refreshGeneration) return
    worldTrafficError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (generation === refreshGeneration) routeReady.value = true
  }
}

const requestRefresh = async () => {
  refreshQueued = true
  if (refreshInFlight) return

  refreshInFlight = true
  try {
    while (refreshQueued && componentAlive) {
      refreshQueued = false
      await refreshRoutes()
    }
  } finally {
    refreshInFlight = false
  }
}

onMounted(async () => {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  await requestRefresh()
})

watchDebounced(connectionSignature, requestRefresh, {
  debounce: 600,
  maxWait: 1800,
})

watchDebounced(
  () => [width.value, height.value],
  () => {
    if (!chart || !mapRegistered) return
    chart.resize()
    applyChartOptions(currentRoutes.value)
  },
  { debounce: 100, maxWait: 300 },
)

onUnmounted(() => {
  componentAlive = false
  refreshQueued = false
  refreshGeneration += 1
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.flight-route-card {
  container-type: inline-size;
  inline-size: min(100%, 1800px);
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent);
  border-radius: 8px;
  background: var(--color-base-100);
  box-shadow: 0 10px 28px color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

.flight-route-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 20px 12px;
}

.flight-route-kicker {
  color: var(--color-primary);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
}

.flight-route-title {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--color-base-content);
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: 0;
  line-height: 1.3;
}

.flight-route-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0;
}

.flight-route-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.flight-route-status-active {
  color: var(--color-success);
}

.flight-route-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-block: 1px solid color-mix(in oklab, var(--color-base-content) 9%, transparent);
  background: color-mix(in oklab, var(--color-base-200) 70%, var(--color-base-100));
}

.flight-route-metric {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  color: color-mix(in oklab, var(--color-base-content) 62%, transparent);
  font-size: 0.76rem;
  letter-spacing: 0;
}

.flight-route-metric + .flight-route-metric {
  border-inline-start: 1px solid color-mix(in oklab, var(--color-base-content) 9%, transparent);
}

.flight-route-metric span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.flight-route-metric strong {
  flex: none;
  color: var(--color-base-content);
  font-size: 0.95rem;
  font-weight: 700;
}

.flight-route-body {
  padding: 12px;
}

.flight-route-surface {
  position: relative;
  width: 100%;
  height: clamp(300px, 46cqw, 720px);
  min-height: 220px;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--color-base-content) 9%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--color-base-200) 82%, var(--color-base-100));
}

.flight-route-chart {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.flight-route-overlay,
.flight-route-message {
  position: absolute;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in oklab, var(--color-base-content) 58%, transparent);
  font-size: 0.82rem;
  letter-spacing: 0;
  text-align: center;
}

.flight-route-overlay {
  inset: 0;
  padding: 24px;
}

.flight-route-message {
  top: 12px;
  right: 12px;
  left: 12px;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid color-mix(in oklab, var(--color-error) 24%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--color-base-100) 92%, transparent);
  color: var(--color-error);
  overflow-wrap: anywhere;
}

@container (max-width: 560px) {
  .flight-route-header {
    padding: 16px 16px 10px;
  }

  .flight-route-title {
    font-size: 0.96rem;
  }

  .flight-route-metric {
    padding: 9px 14px;
  }

  .flight-route-body {
    padding: 8px;
  }

  .flight-route-surface {
    height: clamp(230px, 66cqw, 340px);
  }
}

@container (min-width: 561px) and (max-width: 900px) {
  .flight-route-surface {
    height: clamp(280px, 50cqw, 440px);
  }
}
</style>
