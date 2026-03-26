<template>
  <div class="card">
    <div class="card-title px-4 pt-4">
      {{ $t('globalRouteMatrix') }}
    </div>
    <div class="px-2 pb-2">
      <div
        class="bg-base-200/40 relative w-full overflow-hidden rounded-xl"
        :style="chartContainerStyle"
      >
        <div
          ref="chartRef"
          class="absolute inset-0 h-full w-full"
        ></div>
        <div
          v-if="worldTrafficError"
          class="text-base-content/70 bg-base-100/60 absolute top-2 right-2 left-2 z-10 rounded-md px-3 py-1 text-center text-xs backdrop-blur-sm"
        >
          {{ worldTrafficError }}
        </div>
        <div
          v-else-if="!hasRoutes"
          class="text-base-content/50 absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
        >
          {{ $t('noData') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { resolveSvgTrafficRoutes } from '@/composables/svgTrafficModel'
import { activeConnections } from '@/store/connections'
import { useElementSize } from '@vueuse/core'
import { EffectScatterChart, LinesChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

echarts.use([
  GeoComponent,
  TooltipComponent,
  ScatterChart,
  EffectScatterChart,
  LinesChart,
  CanvasRenderer,
])

useI18n()
const chartRef = ref<HTMLDivElement>()
const routeReady = ref(false)
const worldTrafficError = ref('')
const hasRoutes = ref(false)
let chart: echarts.ECharts | null = null

const SVG_RATIO = 965 / 467.93
const { width } = useElementSize(chartRef)

const isMobile = computed(() => width.value > 0 && width.value < 640)
const chartHeight = computed(() => {
  if (!width.value) return 320
  const ratioHeight = width.value / SVG_RATIO
  if (isMobile.value) {
    return Math.max(264, Math.min(360, (ratioHeight + 36) * 1.2))
  }
  return Math.max(260, Math.min(420, ratioHeight))
})

const chartContainerStyle = computed(() => ({
  height: `${chartHeight.value}px`,
}))

const getMapModule = async (): Promise<string> => {
  return (await import('@/assets/maps/world-atlantic.svg?raw')).default
}

const getGeoLayout = () => {
  if (isMobile.value) {
    return { top: 6, bottom: 6, left: 2, right: 2 }
  }
  return { top: 10, bottom: 10, left: 10, right: 10 }
}

const getScatterSize = (val: number[]) => {
  const count = val[2] || 0
  const weight = val[3] || 0
  const flow = val[4] || 0
  const base = 5 + count * 1.4 + weight * 7 + Math.min(5, (flow / (120 * 1024 * 1024)) * 5)
  return isMobile.value ? Math.min(18, base * 0.76) : Math.min(26, base)
}

const getEffectScatterSize = (val: number[]) => {
  const count = val[2] || 0
  const weight = val[3] || 0
  const base = 8 + count * 1.6 + weight * 7
  return isMobile.value ? Math.min(20, base * 0.72) : Math.min(28, base)
}

const render = async () => {
  try {
    routeReady.value = false
    worldTrafficError.value = ''
    const svg = await getMapModule()
    echarts.registerMap('global-route-matrix', { svg })

    const routes = await resolveSvgTrafficRoutes(100)
    hasRoutes.value = routes.length > 0

    const scatterMap = new Map<
      string,
      { name: string; value: [number, number, number, number, number] }
    >()
    const addPoint = (name: string, x: number, y: number, extra = 1, weight = 1, flow = 0) => {
      const key = `${name}-${x}-${y}`
      const current = scatterMap.get(key)
      if (current) {
        current.value[2] += extra
        current.value[3] = Math.max(current.value[3], weight)
        current.value[4] += flow
        return
      }
      scatterMap.set(key, { name, value: [x, y, extra, weight, flow] })
    }

    const lines: {
      coords: [number, number][]
      fromName: string
      toName: string
      host: string
      curveness: number
      width: number
      opacity: number
    }[] = []

    const isEurope = (route: (typeof routes)[number]) => {
      const lon = route.destination.geo.longitude
      const lat = route.destination.geo.latitude
      return lon >= -15 && lon <= 45 && lat >= 35 && lat <= 72
    }

    const isNorthAmerica = (route: (typeof routes)[number]) => {
      const lon = route.destination.geo.longitude
      const lat = route.destination.geo.latitude
      return lon <= -30 && lat >= 15
    }

    for (const route of routes) {
      const flow = route.connection.download + route.connection.upload
      const weight = Math.min(1.4, Math.max(0.18, flow / (35 * 1024 * 1024)))

      addPoint(route.source.label, route.source.svg.x, route.source.svg.y, 1, weight, flow)
      addPoint(
        route.destination.label,
        route.destination.svg.x,
        route.destination.svg.y,
        1,
        weight,
        flow,
      )

      const dx = route.destination.svg.x - route.source.svg.x
      const dy = route.destination.svg.y - route.source.svg.y
      const distance = Math.hypot(dx, dy)
      const distanceFactor = Math.min(0.28, Math.max(0.1, (Math.abs(dx) / 1200) * 0.22))
      let curveness = Math.max(0.12, distanceFactor)
      if (isEurope(route)) {
        curveness = -Math.max(0.24, distanceFactor)
      }
      if (isNorthAmerica(route)) {
        curveness = Math.max(0.4, distanceFactor + 0.16)
      }
      const width = Math.min(1.8, Math.max(0.6, (distance / 1200) * 0.9 + weight * 0.8))
      const opacity = Math.min(0.55, Math.max(0.22, (distance / 1400) * 0.32 + weight * 0.15))

      lines.push({
        coords: [
          [route.source.svg.x, route.source.svg.y],
          [route.destination.svg.x, route.destination.svg.y],
        ],
        fromName: route.source.label,
        toName: route.destination.label,
        host: route.host,
        curveness,
        width,
        opacity,
      })

      if (route.proxy) {
        addPoint(route.proxy.label, route.proxy.svg.x, route.proxy.svg.y, 1, weight, flow)
      }
    }

    const geoLayout = getGeoLayout()

    chart?.setOption({
      backgroundColor: 'transparent',
      animationDurationUpdate: 250,
      tooltip: { trigger: 'item' },
      geo: {
        map: 'global-route-matrix',
        roam: false,
        ...geoLayout,
        itemStyle: {
          areaColor: 'rgba(226, 232, 240, 0.32)',
          borderColor: 'rgba(100, 116, 139, 0.46)',
          borderWidth: 1,
        },
      },
      series: [
        {
          type: 'lines',
          coordinateSystem: 'geo',
          effect: {
            show: true,
            period: isMobile.value ? 3 : 2.6,
            trailLength: isMobile.value ? 0.38 : 0.5,
            symbolSize: isMobile.value ? 3.2 : 4.2,
          },
          lineStyle: {
            color: 'rgba(56, 189, 248, 0.32)',
            width: 0.7,
            opacity: 0.28,
            curveness: 0.18,
          },
          data: lines.map((line) => ({
            ...line,
            lineStyle: {
              curveness: line.curveness,
              width: isMobile.value ? Math.max(0.5, line.width * 0.82) : line.width,
              opacity: line.opacity,
            },
          })),
        },
        {
          type: 'scatter',
          coordinateSystem: 'geo',
          symbolSize: (val: number[]) => getScatterSize(val),
          itemStyle: { color: '#f97316', opacity: 0.9 },
          data: Array.from(scatterMap.values()),
        },
        {
          type: 'effectScatter',
          coordinateSystem: 'geo',
          rippleEffect: {
            scale: isMobile.value ? 1.9 : 2.6,
            brushType: 'stroke',
          },
          symbolSize: (val: number[]) => getEffectScatterSize(val),
          itemStyle: { color: '#fb923c', opacity: 0.95 },
          data: Array.from(scatterMap.values()).filter((item) => (item.value[2] || 0) >= 2),
        },
      ],
    })
  } catch (error) {
    worldTrafficError.value = error instanceof Error ? error.message : String(error)
  } finally {
    routeReady.value = true
  }
}

onMounted(async () => {
  chart = echarts.init(chartRef.value)
  await render()
})

watch(
  activeConnections,
  async () => {
    if (!chart) return
    await render()
  },
  { deep: true },
)

watch(width, async () => {
  if (!chart) return
  chart.resize()
  await render()
})

onUnmounted(() => {
  chart?.dispose()
  chart = null
})
</script>
