<template>
  <div
    class="h-full overflow-x-hidden overflow-y-auto"
    :style="padding"
  >
    <OverviewCtrl />
    <div class="flex flex-col gap-3 p-3">
      <component
        v-for="item in visibleCards"
        :key="item.card"
        :is="cardComponents[item.card]"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import OverviewCtrl from '@/components/controls/OverviewCtrl.vue'
import ChartsCard from '@/components/overview/ChartsCard.vue'
import ConnectionHistory from '@/components/overview/ConnectionHistory.vue'
import NetworkCard from '@/components/overview/NetworkCard.vue'
import ProviderTrafficOverview from '@/components/overview/ProviderTrafficOverview.vue'
import RuleHitCountCard from '@/components/overview/RuleHitCountCard.vue'
import TopologyCharts from '@/components/overview/TopologyCharts.vue'
import WorldTrafficMapCard from '@/components/overview/WorldTrafficMapCard.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { FLIGHTROUTE_OVERVIEW_CARD } from '@/modules/flightroute/overview'
import { overviewCardOrder } from '@/store/settings'
import type { Component } from 'vue'
import { computed } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const visibleCards = computed(() => {
  return overviewCardOrder.value.filter((card) => card.visible)
})

const cardComponents: Record<string, Component> = {
  ChartsCard,
  NetworkCard,
  ProviderTrafficOverview,
  TopologyCharts,
  [FLIGHTROUTE_OVERVIEW_CARD]: WorldTrafficMapCard,
  ConnectionHistory,
  RuleHitCountCard,
}
</script>
