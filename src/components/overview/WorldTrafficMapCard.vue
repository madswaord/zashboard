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
        v-if="!publicEgress && !worldTrafficError"
        class="text-base-content/50 absolute inset-0 flex items-center justify-center text-sm"
      >
        {{ $t('getting') }}
      </div>
      <div
        v-else-if="worldTrafficError && !routeList.length"
        class="text-base-content/50 absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
      >
        {{ worldTrafficError }}
      </div>
      <div
        v-else-if="!routeList.length"
        class="text-base-content/50 absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
      >
        {{ $t('worldTrafficMapNoBaseMap') }}
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
    if (!route.source || !route.destination) return

    pushPoint(route.source)
    pushPoint(route.destination)

    if (route.proxy) {
      pushPoint(route.proxy)
      lines.push({
        coords: [
          [route.source.longitude, route.source.latitude],
          [route.proxy.longitude, route.proxy.latitude],
        ],
        fromName: pointName(route.source),
        toName: pointName(route.proxy),
        routeId: route.id,
        host: route.host,
        finalOutboundName: route.finalOutboundName,
      })
      lines.push({
        coords: [
          [route.proxy.longitude, route.proxy.latitude],
          [route.destination.longitude, route.destination.latitude],
        ],
        fromName: pointName(route.proxy),
        toName: pointName(route.destination),
        routeId: route.id,
        host: route.host,
        finalOutboundName: route.finalOutboundName,
      })
    } else {
      lines.push({
        coords: [
          [route.source.longitude, route.source.latitude],
          [route.destination.longitude, route.destination.latitude],
        ],
        fromName: pointName(route.source),
        toName: pointName(route.destination),
        routeId: route.id,
        host: route.host,
        finalOutboundName: route.finalOutboundName,
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
      itemStyle: {
        areaColor: '#1f2937',
        borderColor: '#4b5563',
      },
      emphasis: {
        itemStyle: {
          areaColor: '#374151',
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
          period: 5,
          trailLength: 0.15,
          symbolSize: 3,
        },
        lineStyle: {
          color: '#60a5fa',
          width: 1,
          opacity: 0.8,
          curveness: 0.2,
        },
        data: lines,
      },
      {
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 3,
        symbolSize: (val: number[]) => Math.min(20, 6 + (val[2] || 1)),
        itemStyle: {
          color: '#f59e0b',
        },
        data: Array.from(scatterMap.values()),
      },
    ],
  }
})

let chart: echarts.ECharts | null = null

const ensureWorldMap = async () => {
  if (echarts.getMap('world')) return false
  return false
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
