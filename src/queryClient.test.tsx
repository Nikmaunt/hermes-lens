// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useMutation, useQuery } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createAppQueryClient } from './queryClient'

/*
 * The app owns its own offline story: queries fall back to the endpoint
 * cache inside queryFn, mutations enqueue into the offline mutation queue
 * inside mutationFn. TanStack's default networkMode ('online') would PAUSE
 * both while the browser reports offline — pausing exactly the code that
 * knows what to do offline. These tests pin networkMode:'always' down so a
 * config regression fails loudly.
 */

afterEach(() => {
  onlineManager.setOnline(true)
})

function wrapperFor(client: ReturnType<typeof createAppQueryClient>) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('app QueryClient offline behavior', () => {
  it('still runs queryFn while the browser reports offline (cache fallback lives there)', async () => {
    onlineManager.setOnline(false)
    const queryFn = vi.fn(() => Promise.resolve('cached-or-fresh'))

    const { result } = renderHook(
      () => useQuery({ queryKey: ['probe'], queryFn, retry: false }),
      { wrapper: wrapperFor(createAppQueryClient()) },
    )

    await waitFor(() => expect(result.current.data).toBe('cached-or-fresh'))
    expect(queryFn).toHaveBeenCalled()
  })

  it('still runs mutationFn while the browser reports offline (the offline queue lives there)', async () => {
    onlineManager.setOnline(false)
    const mutationFn = vi.fn((text: string) => Promise.resolve(text))

    const { result } = renderHook(() => useMutation({ mutationFn }), {
      wrapper: wrapperFor(createAppQueryClient()),
    })
    result.current.mutate('queued note')

    await waitFor(() => expect(mutationFn).toHaveBeenCalledWith('queued note'))
  })

  it('keeps refetchOnWindowFocus off', () => {
    const client = createAppQueryClient()
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
