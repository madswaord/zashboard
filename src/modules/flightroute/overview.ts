export const FLIGHTROUTE_OVERVIEW_CARD = 'custom:world-traffic-map' as const
export const LEGACY_FLIGHTROUTE_OVERVIEW_CARD = 'WorldTrafficMap' as const

export type FlightRouteOverviewCard = typeof FLIGHTROUTE_OVERVIEW_CARD

export interface OverviewCardItem {
  card: string
  visible: boolean
}

const normalizeCardId = (card: string) => {
  if (card === LEGACY_FLIGHTROUTE_OVERVIEW_CARD) {
    return FLIGHTROUTE_OVERVIEW_CARD
  }

  return card
}

export const normalizeOverviewCardOrder = (cards: OverviewCardItem[]) => {
  const normalizedCards: OverviewCardItem[] = []
  const seen = new Set<string>()

  for (const item of cards) {
    const card = normalizeCardId(item.card)
    if (seen.has(card)) {
      continue
    }

    seen.add(card)
    normalizedCards.push({
      ...item,
      card,
    })
  }

  return normalizedCards
}

export const ensureFlightRouteOverviewCard = (cards: OverviewCardItem[]) => {
  const normalizedCards = normalizeOverviewCardOrder(cards)
  if (normalizedCards.some((item) => item.card === FLIGHTROUTE_OVERVIEW_CARD)) {
    return normalizedCards
  }

  return [
    {
      card: FLIGHTROUTE_OVERVIEW_CARD,
      visible: true,
    },
    ...normalizedCards,
  ]
}
