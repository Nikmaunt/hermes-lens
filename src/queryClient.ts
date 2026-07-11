import { QueryClient } from '@tanstack/react-query'

/**
 * The app owns its own offline story: queries fall back to the endpoint
 * cache inside queryFn, mutations enqueue into the offline mutation queue
 * inside mutationFn. TanStack's default networkMode ('online') would pause
 * both while the browser reports offline — pausing exactly the code that
 * knows what to do offline — so both sides run 'always'.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        networkMode: 'always',
      },
      mutations: {
        networkMode: 'always',
      },
    },
  })
}
