import { IP_INFO_API } from '@/constant'
import { IPInfoAPI } from '@/store/settings'
import * as ipaddr from 'ipaddr.js'
import { fetchJSON } from './fetchJson'

export interface GeoPoint {
  ip: string
  country?: string
  region?: string
  city?: string
  asn?: string
  organization?: string
  latitude: number
  longitude: number
  source: string
}

interface IpsbResponse {
  ip?: string
  country?: string
  region?: string
  city?: string
  asn?: number | string
  organization?: string
  latitude?: number | string
  longitude?: number | string
}

interface IpWhoisResponse {
  ip?: string
  country?: string
  region?: string
  city?: string
  latitude?: number | string
  longitude?: number | string
  connection?: {
    asn?: number | string
    org?: string
  }
}

interface IpApiIsResponse {
  ip?: string
  asn?: {
    asn?: number | string
    org?: string
  }
  location?: {
    country?: string
    state?: string
    city?: string
    latitude?: number | string
    longitude?: number | string
  }
}

interface DnsResponse {
  Answer?: Array<{
    data?: string
  }>
}

const CACHE_PREFIX = 'cache/geo-point/'
const CACHE_TTL = 1000 * 60 * 60 * 24
const DNS_CACHE_TTL = 1000 * 60 * 60
const DNS_NEGATIVE_CACHE_TTL = 1000 * 60
const GEO_NEGATIVE_CACHE_TTL = 1000 * 60 * 5
const GEO_ERROR_BACKOFF = 1000 * 60
const REQUEST_TIMEOUT = 8000
const pendingMap = new Map<string, Promise<GeoPoint | null>>()
const dnsCache = new Map<string, { value: string | null; expiresAt: number }>()
const negativeGeoCache = new Map<string, number>()

const readCache = (key: string) => {
  const remove = () => {
    try {
      localStorage.removeItem(CACHE_PREFIX + key)
    } catch {}
  }

  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { timestamp: number; data: GeoPoint }
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      remove()
      return null
    }
    return parsed.data
  } catch {
    remove()
    return null
  }
}

const writeCache = (key: string, data: GeoPoint) => {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ timestamp: Date.now(), data }))
  } catch {}
}

const normalizeNumber = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : NaN
}

const validPoint = (lat: number, lng: number) => {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

const fetchProviderJSON = async <T>(url: string, label: string) => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    return await fetchJSON<T>(url, { signal: controller.signal }, label)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const stripPort = (value: string) => {
  const candidate = value.trim()
  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/)
  if (bracketed) return bracketed[1]

  const colonCount = (candidate.match(/:/g) || []).length
  if (colonCount === 1 && /:\d+$/.test(candidate)) {
    return candidate.replace(/:\d+$/, '')
  }

  return candidate
}

const normalizePublicIP = (value: string) => {
  const candidate = stripPort(value)
  if (!ipaddr.isValid(candidate)) return null

  let address = ipaddr.parse(candidate)
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    address = address.toIPv4Address()
  }

  return address.range() === 'unicast' ? address.toString() : null
}

const resolveGeoTarget = async (value: string) => {
  const directIP = normalizePublicIP(value)
  if (directIP) return directIP

  const hostname = stripPort(value).toLowerCase()
  if (!hostname || hostname.includes(' ') || !hostname.includes('.')) return null
  const cached = dnsCache.get(hostname)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  dnsCache.delete(hostname)

  try {
    let ip: string | null | undefined = null
    for (const type of ['A', 'AAAA']) {
      const response = await fetchProviderJSON<DnsResponse>(
        `https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=${type}`,
        'dns.alidns.com',
      )
      ip = response.Answer?.map((answer) => answer.data || '')
        .map(normalizePublicIP)
        .find(Boolean)
      if (ip) break
    }

    const resolved = ip || null
    dnsCache.set(hostname, {
      value: resolved,
      expiresAt: Date.now() + (resolved ? DNS_CACHE_TTL : DNS_NEGATIVE_CACHE_TTL),
    })
    return resolved
  } catch {
    dnsCache.set(hostname, {
      value: null,
      expiresAt: Date.now() + DNS_NEGATIVE_CACHE_TTL,
    })
    return null
  }
}

const fromIpsb = async (ip: string): Promise<GeoPoint | null> => {
  const data = await fetchProviderJSON<IpsbResponse>(
    `https://api.ip.sb/geoip/${ip}?t=${Date.now()}`,
    'ip.sb',
  )
  const lat = normalizeNumber(data.latitude)
  const lng = normalizeNumber(data.longitude)
  if (!validPoint(lat, lng)) return null
  return {
    ip: data.ip || ip,
    country: data.country,
    region: data.region,
    city: data.city,
    asn: String(data.asn || ''),
    organization: data.organization,
    latitude: lat,
    longitude: lng,
    source: 'ip.sb',
  }
}

const fromIPWhois = async (ip: string): Promise<GeoPoint | null> => {
  const data = await fetchProviderJSON<IpWhoisResponse>(
    `https://ipwho.is/${ip}?t=${Date.now()}`,
    'ipwho.is',
  )
  const lat = normalizeNumber(data.latitude)
  const lng = normalizeNumber(data.longitude)
  if (!validPoint(lat, lng)) return null
  return {
    ip: data.ip || ip,
    country: data.country,
    region: data.region,
    city: data.city,
    asn: String(data?.connection?.asn || ''),
    organization: data?.connection?.org,
    latitude: lat,
    longitude: lng,
    source: 'ipwho.is',
  }
}

const fromIPApiIs = async (ip: string): Promise<GeoPoint | null> => {
  const data = await fetchProviderJSON<IpApiIsResponse>(
    `https://api.ipapi.is/?q=${encodeURIComponent(ip)}&t=${Date.now()}`,
    'ipapi.is',
  )
  const lat = normalizeNumber(data?.location?.latitude)
  const lng = normalizeNumber(data?.location?.longitude)
  if (!validPoint(lat, lng)) return null
  return {
    ip: data.ip || ip,
    country: data?.location?.country,
    region: data?.location?.state,
    city: data?.location?.city,
    asn: String(data?.asn?.asn || ''),
    organization: data?.asn?.org,
    latitude: lat,
    longitude: lng,
    source: 'ipapi.is',
  }
}

const tryProviders = async (
  ip: string,
  providers: Array<(ip: string) => Promise<GeoPoint | null>>,
): Promise<GeoPoint | null> => {
  let lastError: unknown = null

  for (const provider of providers) {
    try {
      const result = await provider(ip)
      if (result) return result
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return null
}

const fetchGeoPointInner = async (ip: string): Promise<GeoPoint | null> => {
  switch (IPInfoAPI.value) {
    case IP_INFO_API.IPAPI:
      return await tryProviders(ip, [fromIPApiIs, fromIPWhois, fromIpsb])
    case IP_INFO_API.IPWHOIS:
      return await tryProviders(ip, [fromIPWhois, fromIPApiIs, fromIpsb])
    case IP_INFO_API.IPSB:
    default:
      return await tryProviders(ip, [fromIPWhois, fromIPApiIs, fromIpsb])
  }
}

export const fetchGeoPoint = async (address: string): Promise<GeoPoint | null> => {
  const ip = await resolveGeoTarget(address)
  if (!ip) return null

  const cache = readCache(ip)
  if (cache) return cache

  const negativeUntil = negativeGeoCache.get(ip)
  if (negativeUntil && negativeUntil > Date.now()) return null
  negativeGeoCache.delete(ip)

  const pending = pendingMap.get(ip)
  if (pending) return pending

  const promise = fetchGeoPointInner(ip)
    .then((data) => {
      if (data) writeCache(ip, data)
      else negativeGeoCache.set(ip, Date.now() + GEO_NEGATIVE_CACHE_TTL)
      pendingMap.delete(ip)
      return data
    })
    .catch((error) => {
      negativeGeoCache.set(ip, Date.now() + GEO_ERROR_BACKOFF)
      pendingMap.delete(ip)
      throw error
    })

  pendingMap.set(ip, promise)
  return promise
}
