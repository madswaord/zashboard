import { getIPFromIpipnetAPI, getIPInfo } from '@/api/geoip'
import { ref } from 'vue'

export interface NetworkGeoInfo {
  ip: string
  country?: string
  region?: string
  city?: string
  organization?: string
  source: 'ipip.net' | 'geoip'
}

export const networkChinaInfo = ref<NetworkGeoInfo | null>(null)
export const networkGlobalInfo = ref<NetworkGeoInfo | null>(null)
export const networkInfoLoading = ref(false)
export const networkInfoError = ref('')

let pending: Promise<void> | null = null

export const refreshNetworkInfo = async () => {
  if (pending) return pending

  pending = (async () => {
    networkInfoLoading.value = true
    networkInfoError.value = ''

    try {
      const [china, global] = await Promise.allSettled([getIPFromIpipnetAPI(), getIPInfo()])

      if (china.status === 'fulfilled') {
        networkChinaInfo.value = {
          ip: china.value.data.ip,
          country: china.value.data.location[0],
          region: china.value.data.location[1],
          city: china.value.data.location[2],
          source: 'ipip.net',
        }
      }

      if (global.status === 'fulfilled') {
        networkGlobalInfo.value = {
          ip: global.value.ip,
          country: global.value.country,
          region: global.value.region,
          city: global.value.city,
          organization: global.value.organization,
          source: 'geoip',
        }
      }

      if (china.status === 'rejected' && global.status === 'rejected') {
        throw new Error('network info unavailable')
      }
    } catch (error) {
      networkInfoError.value = error instanceof Error ? error.message : String(error)
    } finally {
      networkInfoLoading.value = false
      pending = null
    }
  })()

  return pending
}
