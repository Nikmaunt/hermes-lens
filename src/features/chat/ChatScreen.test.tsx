// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEndpointCache } from '@/data/cache'
import type { DataSource } from '@/data/DataSource'
import { DataContext } from '@/data/DataSourceProvider'
import { MemoryKV, preferencesKV } from '@/data/kv'
import { MockDataSource } from '@/data/MockDataSource'
import { createMutationQueue } from '@/data/mutationQueue'
import { SnackbarProvider } from '@/components/SnackbarProvider'
import { SettingsProvider } from '@/settings/SettingsProvider'
import { ACTIVE_TURN_KEY } from './activeChat'
import { ChatScreen } from './ChatScreen'
import { TRANSCRIPT_KEY } from './transcript'

/*
 * Integration tests for the /chat wiring — the coverage deliberately deferred
 * "to the screen" from steps 3/4/5. They drive the real ChatScreen +
 * useChatController against a MockDataSource, with fake timers advancing the
 * 2s refetchInterval, so the poll → persist → reattach → transcript path is a
 * regression test rather than only a one-off preview run.
 */

interface ParsedTranscript {
  sessionId: string | null
  messages: { role: string; text: string; tokensUsed?: number }[]
}

function harness(ds: DataSource) {
  const kv = new MemoryKV() // backs cache/queue only; chat uses preferencesKV directly
  const value = {
    ds,
    cache: createEndpointCache(kv),
    queue: createMutationQueue(kv),
    pendingCount: 0,
    deadLetterCount: 0,
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <DataContext.Provider value={value}>
          <SnackbarProvider>
            <MemoryRouter initialEntries={['/chat']}>
              <ChatScreen />
            </MemoryRouter>
          </SnackbarProvider>
        </DataContext.Provider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

/** Advance a bounded slice of fake time (for asserting a mid-flight state). */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Run the turn to its terminal state. Every chat flow stops polling on
 * done/error/expired, so draining all pending timers converges (no infinite
 * interval); a second pass flushes the done→append→dismiss effect chain.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  await act(async () => {
    await vi.runAllTimersAsync()
  })
}

function typeMessage(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('Ask Hermes…'), { target: { value } })
}

function clickButton(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  focusManager.setFocused(true) // jsdom/headless can read as hidden, pausing polls
  // jsdom does not implement scrollIntoView; the auto-scroll effect calls it.
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  focusManager.setFocused(true)
  localStorage.clear()
})

describe('ChatScreen integration', () => {
  it('gives the message list its own scroll container so the page does not scroll (Fix A)', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    const { container } = render(harness(ds))
    await tick(20) // let loadTranscript settle → the empty state renders

    // The message list is the sole scroller on /chat: an overflow-y-auto box
    // with overscroll containment, so the document itself never scrolls and a
    // bottom bounce can't drag the composer off the fixed BottomNav. jsdom does
    // no layout, so assert the structural contract at the class level. The
    // combined selector pins the list, not the composer's own scrolling
    // textarea (which is overflow-y-auto but never overscroll-none).
    const scroller = container.querySelector('.overflow-y-auto.overscroll-none')
    expect(scroller).not.toBeNull()
    // The old document-height column (a 100dvh min-height) is gone.
    expect(container.innerHTML).not.toMatch(/100dvh/)
  })

  it('runs a full turn: send → poll running→done → reply bubble with token meter', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    render(harness(ds))
    await tick(20)

    typeMessage('Who am I?')
    clickButton('Send')
    await tick(300) // startChat + first poll, still short of the 2s interval
    expect(screen.getByText('Hermes is thinking…')).toBeInTheDocument()

    await settle() // the 2s refetchInterval fires → second poll → done
    expect(screen.getByText(/Connect the agent for a real answer/)).toBeInTheDocument()
    expect(screen.getByText(/128 tokens/)).toBeInTheDocument()
    expect(screen.queryByText('Hermes is thinking…')).toBeNull()
  })

  it('re-attaches a persisted turn on remount and finishes without a second POST', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    const startSpy = vi.spyOn(ds, 'startChat')
    const { unmount } = render(harness(ds))
    await tick(20)

    typeMessage('Who am I?')
    clickButton('Send')
    await tick(300) // running, mid-turn
    expect(screen.getByText('Hermes is thinking…')).toBeInTheDocument()
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(await preferencesKV.get(ACTIVE_TURN_KEY)).not.toBeNull()

    // Kill the screen mid-turn (a 30s relock unmounts it; or an app kill).
    unmount()

    // Re-mount with the SAME data source: the controller re-adopts the job.
    render(harness(ds))
    await settle() // reattach's poll resolves the job to done
    expect(screen.getByText(/Connect the agent for a real answer/)).toBeInTheDocument()
    expect(startSpy).toHaveBeenCalledTimes(1) // no second turn was started
  })

  it('appends the finished turn to the transcript and continues its session', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    const startSpy = vi.spyOn(ds, 'startChat')
    render(harness(ds))
    await tick(20)

    typeMessage('Who am I?')
    clickButton('Send')
    await settle()
    expect(screen.getByText(/Connect the agent for a real answer/)).toBeInTheDocument()

    const raw = await preferencesKV.get(TRANSCRIPT_KEY)
    expect(raw).not.toBeNull()
    const transcript = JSON.parse(raw ?? '{}') as ParsedTranscript
    expect(transcript.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(transcript.messages[0]?.text).toBe('Who am I?')
    expect(transcript.messages[1]?.tokensUsed).toBe(128)
    const sessionId = transcript.sessionId
    expect(typeof sessionId).toBe('string')

    // Second turn must continue the SAME server session (one rolling session).
    typeMessage('And where do I live?')
    clickButton('Send')
    await tick(50) // startChat is invoked synchronously; let the call record
    expect(startSpy).toHaveBeenCalledTimes(2)
    expect(startSpy.mock.calls[1]?.[0]?.sessionId).toBe(sessionId)
  })

  it('retries a failed turn with the same clientId — server dedup, no second turn', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    const startSpy = vi.spyOn(ds, 'startChat')
    // Force the turn to come back as an agent error so the retry path shows.
    vi.spyOn(ds, 'getChatJob').mockResolvedValue({ jobId: 'j', status: 'error', error: 'boom' })
    render(harness(ds))
    await tick(20)

    typeMessage('Who am I?')
    clickButton('Send')
    await settle()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(startSpy).toHaveBeenCalledTimes(1)
    const clientId1 = startSpy.mock.calls[0]?.[0]?.clientId
    expect(clientId1).toBeTruthy()

    clickButton('Retry')
    await settle()
    expect(startSpy).toHaveBeenCalledTimes(2)
    // Same idempotency key → the server dedups to the same job (D-A8).
    expect(startSpy.mock.calls[1]?.[0]?.clientId).toBe(clientId1)
    const first = await startSpy.mock.results[0]?.value
    const second = await startSpy.mock.results[1]?.value
    expect(second.jobId).toBe(first.jobId) // one turn on the server, not two
  })

  it('re-attaching to an expired job shows a clean expired state and clears the handle', async () => {
    const ds = new MockDataSource(new MemoryKV(), 0)
    // A persisted handle whose job the server (mock) no longer knows → 404.
    await preferencesKV.set(
      ACTIVE_TURN_KEY,
      JSON.stringify({
        jobId: 'job-mock-gone',
        sessionId: 'sess-x',
        clientId: 'cli-x',
        userMessage: 'still there?',
        startedAt: Date.now(),
      }),
    )

    render(harness(ds))
    await settle() // mount reattach → poll → 404 → expired

    expect(screen.getByText(/expired/i)).toBeInTheDocument()
    expect(screen.getByText('still there?')).toBeInTheDocument() // the question stays
    // The dead handle is cleared so a later reattach never re-polls it.
    expect(await preferencesKV.get(ACTIVE_TURN_KEY)).toBeNull()
  })
})
