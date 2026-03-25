import { fetchJSON } from '@/helper/fetch-json'

export interface PublicIPResult {
  ip: string
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

const readTextWithTimeout = async (url: string, timeout = 5000) => {
  const response = await withTimeout(url, {}, timeout)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${url} responded with ${response.status}: ${text.slice(0, 80)}`)
  }
  return await response.text()
}

const extractIPv4 = (text: string) => {
  const match = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  return match?.[0] || ''
}

const providers: (() => Promise<PublicIPResult>)[] = [
  async () => {
    const data = await fetchJSON<{
      data?: {
        ip?: string
      }
    }>('https://myip.ipip.net/json', {}, 'ipip.net')
    const ip = data?.data?.ip
    if (!ip) throw new Error('ipip.net missing ip')
    return { ip, source: 'ipip.net' }
  },
  async () => {
    const text = await readTextWithTimeout('https://4.ipw.cn', 5000)
    const ip = extractIPv4(text)
    if (!ip) throw new Error('4.ipw.cn missing ip')
    return { ip, source: '4.ipw.cn' }
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
