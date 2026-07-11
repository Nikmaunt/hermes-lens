// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { InboxItem } from '@/schemas'
import { SwipeCard } from './InboxScreen'

// Vitest runs without injected globals, so RTL's auto-cleanup never registers.
afterEach(cleanup)

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

const item: InboxItem = {
  id: 'in-1',
  text: 'a fleeting thought',
  capturedAt: '2026-07-11T09:30:00+02:00',
  source: 'capture',
  tags: [],
}

const mapping = { right: 'note', left: 'archive', up: 'memory', down: 'trash' } as const

/** Swipe the card far enough right to trigger the fling commit. */
function flingRight(card: HTMLElement) {
  // jsdom has no pointer capture; the component calls it on pointerdown.
  card.setPointerCapture = () => undefined
  fireEvent.pointerDown(card, { pointerId: 1, clientX: 0, clientY: 0 })
  fireEvent.pointerMove(card, { pointerId: 1, clientX: 200, clientY: 0 })
  fireEvent.pointerUp(card, { pointerId: 1 })
}

function renderCard(onDecide: (direction: keyof typeof mapping) => void) {
  return render(
    <SwipeCard
      item={item}
      mapping={mapping}
      onDecide={onDecide}
      expanded={false}
      onToggleExpanded={() => undefined}
    />,
  )
}

describe('SwipeCard fling timer', () => {
  it('commits the decision immediately when unmounted inside the fling window', async () => {
    // The 160 ms fling delay is animation, not grace: a user who swiped and
    // navigated away decided already — unmount must commit, not drop it.
    const onDecide = vi.fn()
    const { container, unmount } = renderCard(onDecide)
    flingRight(container.firstElementChild as HTMLElement)
    expect(onDecide).not.toHaveBeenCalled() // animation window still open

    unmount()
    expect(onDecide).toHaveBeenCalledExactlyOnceWith('right')

    // The timer was cleared — no second commit when it would have fired.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(onDecide).toHaveBeenCalledTimes(1)
  })

  it('does not double-commit when the timer fired before unmount', async () => {
    const onDecide = vi.fn()
    const { container, unmount } = renderCard(onDecide)
    flingRight(container.firstElementChild as HTMLElement)

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(onDecide).toHaveBeenCalledExactlyOnceWith('right')

    unmount()
    expect(onDecide).toHaveBeenCalledTimes(1)
  })
})
