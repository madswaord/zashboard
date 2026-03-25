import { fetchJSON } from '@/helper/fetch-json'

export interface PublicIPResult {
  ip: string
  country?: string
  region?: string
  city?: string
  latitude?: number
  longitude?: number
  source: string
}

const CACHE_KEY = 'cache/public-ip-cn'
const CACHE_TTL = 1000 * 60 * 30

const readCache = (): PublicIPResult | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { timestamp: number; data: PublicIPResult }
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null
    return parsed.data
  } catch {
    return null
  }
}

const writeCache = (data: PublicIPResult) => {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        data,
      }),
    )
  } catch {}
}

const withTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeout = 5000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

const providers: (() => Promise<PublicIPResult>)[] = [
  async () => {
    const res = await withTimeout('https://4.ipw.cn/api/ip/myip?json', {}, 5000)
    const data = await fetchJSON<{
      code?: number
      data?: {
        ip?: string
        location?: string
      }
      IP?: string
      ip?: string
    }>(res.url, {}, 'ipw.cn')
    const ip = data?.data?.ip || data?.IP || data?.ip
    if (!ip) throw new Error('ipw.cn missing ip')
    return {
      ip,
      source: 'ipw.cn',
    }
  },
  async () => {
    const res = await withTimeout('https://forge.speedtest.cn/api/location/info', {}, 5000)
    const data = await fetchJSON<{
      data?: {
        ip?: string
        country?: string
        province?: string
        city?: string
        lat?: number | string
        lng?: number | string
      }
    }>(res.url, {}, 'speedtest.cn')
    const ip = data?.data?.ip
    if (!ip) throw new Error('speedtest.cn missing ip')
    return {
      ip,
      country: data?.data?.country,
      region: data?.data?.province,
      city: data?.data?.city,
      latitude: Number(data?.data?.lat),
      longitude: Number(data?.data?.lng),
      source: 'speedtest.cn',
    }
  },
  async () => {
    const res = await withTimeout('https://myip.ipip.net/json', {}, 5000)
    const data = await fetchJSON<{
      data?: {
        ip?: string
        location?: string[]
      }
    }>(res.url, {}, 'ipip.net')
    const ip = data?.data?.ip
    if (!ip) throw new Error('ipip missing ip')
    const location = data?.data?.location || []
    return {
      ip,
      country: location[0],
      region: location[1],
      city: location[2],
      source: 'ipip.net',
    }
  },
]

export const fetchPublicIP = async (force = false) => {
  if (!force) {
    const cache = readCache()
    if (cache) return cache
  }

  let lastError: unknown

  for (const provider of providers) {
    try {
      const result = await provider()
      writeCache(result)
      return result
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('failed to fetch public ip')
}
