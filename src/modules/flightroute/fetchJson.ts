const previewText = (text: string, max = 120) => {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

const getContentType = (response: Response) => {
  return response.headers.get('content-type') || ''
}

export const fetchJSON = async <T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  label?: string,
): Promise<T> => {
  const response = await fetch(input, init)
  const contentType = getContentType(response)
  const source = label || (typeof input === 'string' ? input : input.toString())

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${source} responded with ${response.status}: ${previewText(text)}`)
  }

  if (!contentType.includes('json')) {
    const text = await response.text().catch(() => '')
    throw new Error(`${source} returned non-JSON content: ${previewText(text)}`)
  }

  return (await response.json()) as T
}
