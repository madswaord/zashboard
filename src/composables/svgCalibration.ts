export const atlanticSvgAnchors = {
  Shanghai: { lon: 121.47, lat: 31.23, x: 392.92569335170197, y: 143.03051256286744 },
  'San Francisco': { lon: -122.42, lat: 37.77, x: 701.0388245875045, y: 118.32274741753783 },
  'New York': { lon: -74.0, lat: 40.71, x: 830.1951704648363, y: 117.63049572555299 },
  Paris: { lon: 2.35, lat: 48.86, x: 77.67842407708116, y: 94.09461360308178 },
  Sydney: { lon: 151.21, lat: -33.87, x: 469.62905325771214, y: 317.46710379957784 },
  'Sao Paulo': { lon: -46.63, lat: -23.55, x: 901.9023744023943, y: 287.98817384302464 },
  Tokyo: { lon: 139.69, lat: 35.68, x: 441.9803551380462, y: 130.72568776631843 },
  London: { lon: -0.1276, lat: 51.5072, x: 68.9527368627632, y: 88.04327644820006 },
  'Los Angeles': { lon: -118.2437, lat: 34.0522, x: 715.4989078319685, y: 135.11623349613308 },
  Vancouver: { lon: -123.1207, lat: 49.2827, x: 702.337209753649, y: 93.38815800693817 },
  'Cape Town': { lon: 18.4241, lat: -33.9249, x: 119.13370294453563, y: 315.76286208853077 },
  Cairo: { lon: 31.2357, lat: 30.0444, x: 153.09775796025167, y: 144.45589401207687 },
  Chicago: { lon: -87.6298, lat: 41.8781, x: 795.6118875502879, y: 113.53368756428078 },
  Singapore: { lon: 103.8198, lat: 1.3521, x: 346.67834789261184, y: 221.8563248477575 },
  Miami: { lon: -80.1918, lat: 25.7617, x: 815.451471474496, y: 157.70351737059607 },
  Beijing: { lon: 116.4074, lat: 39.9042, x: 377.22774620298725, y: 119.33243536063839 },
  'Hong Kong': { lon: 114.1694, lat: 22.3193, x: 376.80397065706495, y: 164.23180244070358 },
  Busan: { lon: 129.0756, lat: 35.1796, x: 413.8301298425683, y: 131.40568161420103 },
  Pyongyang: { lon: 125.7625, lat: 39.0392, x: 404.94547947349, y: 120.98969150240899 },
  Seoul: { lon: 126.978, lat: 37.5665, x: 408.4030006158088, y: 124.99223863232376 },
  Moscow: { lon: 37.6173, lat: 55.7558, x: 176.08843652639246, y: 68.23793441561875 },
  Zhangzhou: { lon: 117.6472, lat: 24.5133, x: 381.4042227148512, y: 159.42527709067693 },
  Xiamen: { lon: 118.0894, lat: 24.4798, x: 384.4296096225017, y: 160.57031279313696 },
  Taipei: { lon: 121.5654, lat: 25.033, x: 393.8338243474876, y: 158.41338507454944 },
} as const

const interpolate = (x1: number, y1: number, x2: number, y2: number, x: number) => {
  if (x2 === x1) return y1
  return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1)
}

const sortedByLon = Object.values(atlanticSvgAnchors)
  .slice()
  .sort((a, b) => a.lon - b.lon)
const sortedByLat = Object.values(atlanticSvgAnchors)
  .slice()
  .sort((a, b) => b.lat - a.lat)

export const lonToAtlanticSvgX = (lon: number) => {
  const arr = sortedByLon
  if (lon <= arr[0].lon) return interpolate(arr[0].lon, arr[0].x, arr[1].lon, arr[1].x, lon)
  if (lon >= arr[arr.length - 1].lon) {
    return interpolate(
      arr[arr.length - 2].lon,
      arr[arr.length - 2].x,
      arr[arr.length - 1].lon,
      arr[arr.length - 1].x,
      lon,
    )
  }
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i]
    const b = arr[i + 1]
    if (lon >= a.lon && lon <= b.lon) {
      return interpolate(a.lon, a.x, b.lon, b.x, lon)
    }
  }
  return arr[0].x
}

export const latToAtlanticSvgY = (lat: number) => {
  const arr = sortedByLat
  if (lat >= arr[0].lat) return interpolate(arr[0].lat, arr[0].y, arr[1].lat, arr[1].y, lat)
  if (lat <= arr[arr.length - 1].lat) {
    return interpolate(
      arr[arr.length - 2].lat,
      arr[arr.length - 2].y,
      arr[arr.length - 1].lat,
      arr[arr.length - 1].y,
      lat,
    )
  }
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i]
    const b = arr[i + 1]
    if (lat <= a.lat && lat >= b.lat) {
      return interpolate(a.lat, a.y, b.lat, b.y, lat)
    }
  }
  return arr[0].y
}
