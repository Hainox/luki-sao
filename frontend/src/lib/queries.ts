import type { QueryClient } from '@tanstack/react-query'

/** После любого изменения карточки обновляем всё, где она видна:
 *  журнал со счётчиками, саму карточку, очередь проверки и свод. */
export function invalidateCardQueries(queryClient: QueryClient, cardId: string) {
  queryClient.invalidateQueries({ queryKey: ['cards'] })
  queryClient.invalidateQueries({ queryKey: ['card', cardId] })
  queryClient.invalidateQueries({ queryKey: ['review-queue'] })
  queryClient.invalidateQueries({ queryKey: ['summary'] })
}
