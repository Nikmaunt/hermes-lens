// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

/*
 * InboxScreen commits still-pending triages from its unmount cleanup by
 * calling mutation.mutate() right before the component goes away. That only
 * works if TanStack Query executes a mutation fired from a component that
 * unmounts immediately after — this probe pins that contract down so a
 * library upgrade that changes the behavior fails loudly.
 */
describe('unmount-commit contract', () => {
  it('a mutation fired right before unmount still executes', async () => {
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const executed: string[] = []
    const { result, unmount } = renderHook(
      () =>
        useMutation({
          mutationFn: async (id: string) => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            executed.push(id)
            return id
          },
        }),
      { wrapper },
    )

    result.current.mutate('in-1')
    unmount()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(executed).toEqual(['in-1'])
  })
})
