<template>
  <div class="card">
    <div class="card-title absolute px-4 pt-4">
      {{ $t('worldTrafficMap') }}
    </div>
    <div class="relative h-96 w-full overflow-hidden pt-12">
      <div
        ref="chartRef"
        class="h-full w-full"
      />
      <div
        v-if="!publicEgress && !routeList.length && !worldTrafficError"
        class="text-base-content/50 absolute inset-0 flex items-center justify-center text-sm"
      >
        {{ $t('getting') }}
      </div>
      <div
        v-if="worldTrafficError"
        class="text-base-content/70 bg-base-100/60 absolute top-13 right-2 left-2 z-10 rounded-md px-3 py-1 text-center text-xs backdrop-blur-sm"
      >
        {{ worldTrafficError }}
      </div>
      <div
        v-else-if="!routeList.length"
        class="text-base-content/50 absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
      >
        {{ $t('noData') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GeoPoint } from '@/api/geoip-map'
import { publicEgress, worldTrafficError, worldTrafficList } from '@/store/worldTrafficMap'
import { useElementSize } from '@vueuse/core'
import { LinesChart, ScatterChart } from 'echarts/charts'
import { GeoComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

echarts.use([GeoComponent, TooltipComponent, ScatterChart, LinesChart, CanvasRenderer])

useI18n()
const chartRef = ref<HTMLDivElement>()
const routeList = computed(() => worldTrafficList.value.slice(0, 200))

const pointName = (point: GeoPoint | null | undefined) => {
  if (!point) return '-'
  return point.city || point.region || point.country || point.ip
}

const normalizeLng = (lng: number) => {
  let value = lng
  while (value > 180) value -= 360
  while (value < -180) value += 360
  return value
}

const buildArcSegments = (from: GeoPoint, to: GeoPoint) => {
  const fromLng = normalizeLng(from.longitude)
  const toLng = normalizeLng(to.longitude)
  const diff = Math.abs(fromLng - toLng)

  if (diff <= 180) {
    return [
      {
        coords: [
          [fromLng, from.latitude],
          [toLng, to.latitude],
        ] as [number, number][],
        curveness: 0.22,
      },
    ]
  }

  const towardEast = fromLng < toLng
  const edgeLng = towardEast ? 180 : -180
  const edgeLng2 = towardEast ? -180 : 180
  const ratio = towardEast
    ? (edgeLng - fromLng) / (toLng - 360 - fromLng)
    : (edgeLng - fromLng) / (toLng + 360 - fromLng)
  const midLat = from.latitude + (to.latitude - from.latitude) * ratio

  return [
    {
      coords: [
        [fromLng, from.latitude],
        [edgeLng, midLat],
      ] as [number, number][],
      curveness: 0.28,
    },
    {
      coords: [
        [edgeLng2, midLat],
        [toLng, to.latitude],
      ] as [number, number][],
      curveness: 0.28,
    },
  ]
}

const options = computed(() => {
  const scatterMap = new Map<
    string,
    { name: string; value: [number, number, number]; ip: string }
  >()
  const lines: {
    coords: [number, number][]
    fromName: string
    toName: string
    routeId: string
    host: string
    finalOutboundName: string | null
    curveness: number
  }[] = []

  const pushPoint = (point: GeoPoint | null | undefined, extra = 1) => {
    if (!point) return
    const key = `${point.ip}-${point.latitude}-${point.longitude}`
    const current = scatterMap.get(key)
    if (current) {
      current.value[2] += extra
      return
    }
    scatterMap.set(key, {
      name: pointName(point),
      value: [point.longitude, point.latitude, extra],
      ip: point.ip,
    })
  }

  routeList.value.forEach((route) => {
    if (!route.destination) return

    pushPoint(route.destination)
    if (route.source) pushPoint(route.source)

    if (route.source && route.proxy) {
      pushPoint(route.proxy)
      buildArcSegments(route.source, route.proxy).forEach((segment) => {
        lines.push({
          coords: segment.coords,
          fromName: pointName(route.source),
          toName: pointName(route.proxy),
          routeId: route.id,
          host: route.host,
          finalOutboundName: route.finalOutboundName,
          curveness: segment.curveness,
        })
      })
      buildArcSegments(route.proxy, route.destination).forEach((segment) => {
        lines.push({
          coords: segment.coords,
          fromName: pointName(route.proxy),
          toName: pointName(route.destination),
          routeId: route.id,
          host: route.host,
          finalOutboundName: route.finalOutboundName,
          curveness: segment.curveness,
        })
      })
    } else if (route.source) {
      buildArcSegments(route.source, route.destination).forEach((segment) => {
        lines.push({
          coords: segment.coords,
          fromName: pointName(route.source),
          toName: pointName(route.destination),
          routeId: route.id,
          host: route.host,
          finalOutboundName: route.finalOutboundName,
          curveness: segment.curveness,
        })
      })
    }
  })

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (params: {
        data?: {
          ip?: string
          fromName?: string
          toName?: string
          host?: string
          finalOutboundName?: string | null
        }
      }) => {
        if (params.data?.ip) {
          return `${params.data.ip}`
        }
        if (params.data?.fromName) {
          return `${params.data.fromName} → ${params.data.toName}<br/>${params.data.host || ''}<br/>${params.data.finalOutboundName || ''}`
        }
        return ''
      },
    },
    geo: {
      map: 'world',
      roam: true,
      silent: true,
      top: 14,
      bottom: 10,
      left: 10,
      right: 10,
      itemStyle: {
        areaColor: 'rgba(148, 163, 184, 0.16)',
        borderColor: 'rgba(148, 163, 184, 0.45)',
        borderWidth: 0.8,
      },
      emphasis: {
        itemStyle: {
          areaColor: 'rgba(148, 163, 184, 0.24)',
        },
      },
    },
    series: [
      {
        type: 'lines',
        coordinateSystem: 'geo',
        zlevel: 2,
        effect: {
          show: true,
          period: 3,
          trailLength: 0.42,
          symbolSize: 3.4,
        },
        lineStyle: {
          color: 'rgba(56, 189, 248, 0.28)',
          width: 0.55,
          opacity: 0.22,
          curveness: 0.18,
        },
        data: lines,
      },
      {
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 3,
        symbolSize: (val: number[]) => Math.min(20, 6 + (val[2] || 1)),
        itemStyle: {
          color: '#f97316',
        },
        data: Array.from(scatterMap.values()),
      },
    ],
  }
})

let chart: echarts.ECharts | null = null

const ensureWorldMap = async () => {
  if (echarts.getMap('world')) return
  const worldJson = await import('@/assets/maps/world-pacific.json')
  echarts.registerMap('world', worldJson.default as never)
}

onMounted(async () => {
  await ensureWorldMap()
  chart = echarts.init(chartRef.value)
  chart.setOption(options.value)
})

watch(
  options,
  (value) => {
    chart?.setOption(value)
  },
  { deep: true },
)

const { width, height } = useElementSize(chartRef)
watch([width, height], () => chart?.resize())

onUnmounted(() => {
  chart?.dispose()
  chart = null
})
</script>
