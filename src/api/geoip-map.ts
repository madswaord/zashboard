import { IP_INFO_API } from '@/constant'
import { fetchJSON } from '@/helper/fetch-json'
import { IPInfoAPI } from '@/store/settings'

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

const CACHE_PREFIX = 'cache/geo-point/'
const CACHE_TTL = 1000 * 60 * 60 * 24
const pendingMap = new Map<string, Promise<GeoPoint | null>>()

const readCache = (key: string) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { timestamp: number; data: GeoPoint }
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null
    return parsed.data
  } catch {
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

const fromIpsb = async (ip: string): Promise<GeoPoint | null> => {
  const data = await fetchJSON<IpsbResponse>(
    `https://api.ip.sb/geoip/${ip}?t=${Date.now()}`,
    {},
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
  const data = await fetchJSON<IpWhoisResponse>(
    `https://ipwho.is/${ip}?t=${Date.now()}`,
    {},
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
  const data = await fetchJSON<IpApiIsResponse>(
    `https://api.ipapi.is/?q=${encodeURIComponent(ip)}&t=${Date.now()}`,
    {},
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

const fetchGeoPointInner = async (ip: string): Promise<GeoPoint | null> => {
  switch (IPInfoAPI.value) {
    case IP_INFO_API.IPAPI:
      return (await fromIPApiIs(ip)) || (await fromIPWhois(ip)) || (await fromIpsb(ip))
    case IP_INFO_API.IPWHOIS:
      return (await fromIPWhois(ip)) || (await fromIPApiIs(ip)) || (await fromIpsb(ip))
    case IP_INFO_API.IPSB:
    default:
      return (await fromIPWhois(ip)) || (await fromIPApiIs(ip)) || (await fromIpsb(ip))
  }
}

export const fetchGeoPoint = async (ip: string): Promise<GeoPoint | null> => {
  if (!ip) return null
  const cache = readCache(ip)
  if (cache) return cache

  const pending = pendingMap.get(ip)
  if (pending) return pending

  const promise = fetchGeoPointInner(ip)
    .then((data) => {
      if (data) writeCache(ip, data)
      pendingMap.delete(ip)
      return data
    })
    .catch((error) => {
      pendingMap.delete(ip)
      throw error
    })

  pendingMap.set(ip, promise)
  return promise
}
