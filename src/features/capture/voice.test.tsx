// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useVoiceCapture, type VoicePluginLike } from './voice'

/**
 * State-machine tests for voice capture. The mock encodes the real Android
 * plugin contract: start({partialResults: true}) resolves as soon as
 * listening begins, transcripts arrive via 'partialResults' events, and the
 * session ends with a 'listeningState' event with state 'stopped'.
 */

type EventName = 'partialResults' | 'listeningState' | 'error'

function createMockPlugin(overrides: Partial<VoicePluginLike> = {}) {
  const listeners: Record<EventName, ((event: never) => void)[]> = {
    partialResults: [],
    listeningState: [],
    error: [],
  }
  const removed: EventName[] = []
  const plugin: VoicePluginLike = {
    available: vi.fn(() => Promise.resolve({ available: true })),
    requestPermissions: vi.fn(() => Promise.resolve({ speechRecognition: 'granted' })),
    start: vi.fn(() => Promise.resolve({})),
    stop: vi.fn(() => Promise.resolve()),
    addListener: vi.fn((eventName: EventName, fn: (event: never) => void) => {
      listeners[eventName].push(fn)
      return Promise.resolve({
        remove: () => {
          removed.push(eventName)
          listeners[eventName] = listeners[eventName].filter((l) => l !== fn)
        },
      })
    }) as VoicePluginLike['addListener'],
    ...overrides,
  }
  const emit = (eventName: EventName, event: unknown) => {
    for (const fn of [...listeners[eventName]]) fn(event as never)
  }
  return { plugin, emit, removed }
}

function setup(overrides: Partial<VoicePluginLike> = {}) {
  const mock = createMockPlugin(overrides)
  const onFinalText = vi.fn()
  const onNotice = vi.fn()
  const hook = renderHook(() =>
    useVoiceCapture(onFinalText, onNotice, { plugin: mock.plugin, isNative: true }),
  )
  return { ...mock, onFinalText, onNotice, hook }
}

describe('useVoiceCapture availability', () => {
  it('stays unavailable off-device (mic hidden, typing keeps working)', () => {
    const mock = createMockPlugin()
    const hook = renderHook(() =>
      useVoiceCapture(vi.fn(), vi.fn(), { plugin: mock.plugin, isNative: false }),
    )
    expect(hook.result.current.state).toBe('unavailable')
    expect(mock.plugin.available).not.toHaveBeenCalled()
  })

  it('becomes idle when the recognizer reports available', async () => {
    const { hook } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
  })

  it('stays unavailable when the recognizer reports unavailable', async () => {
    const { hook, plugin } = setup({
      available: vi.fn(() => Promise.resolve({ available: false })),
    })
    await waitFor(() => expect(plugin.available).toHaveBeenCalled())
    expect(hook.result.current.state).toBe('unavailable')
  })
})

describe('useVoiceCapture permission paths', () => {
  it('permission denied: returns to idle with a human notice, never starts', async () => {
    const { hook, onNotice, plugin } = setup({
      requestPermissions: vi.fn(() => Promise.resolve({ speechRecognition: 'denied' })),
    })
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))

    await act(() => hook.result.current.start())

    expect(hook.result.current.state).toBe('idle')
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/microphone permission/i))
    expect(plugin.start).not.toHaveBeenCalled()
  })

  it('permission bridge failure: goes unavailable with a notice', async () => {
    const { hook, onNotice } = setup({
      requestPermissions: vi.fn(() => Promise.reject(new Error('not implemented'))),
    })
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))

    await act(() => hook.result.current.start())

    expect(hook.result.current.state).toBe('unavailable')
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/isn't available/i))
  })
})

describe('useVoiceCapture start-failure paths', () => {
  it('start rejection surfaces a notice, returns to idle and removes listeners', async () => {
    const { hook, onNotice, removed } = setup({
      start: vi.fn(() => Promise.reject(new Error('Speech recognition service is not available.'))),
    })
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))

    await act(() => hook.result.current.start())

    expect(hook.result.current.state).toBe('idle')
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/isn't available/i))
    expect(removed).toHaveLength(3)
  })

  it('a recognizer error ending the session produces a human notice', async () => {
    const { hook, onNotice, onFinalText, emit } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
    await act(() => hook.result.current.start())
    expect(hook.result.current.state).toBe('listening')

    act(() => {
      emit('error', { code: 'NETWORK', message: 'Network error' })
      emit('listeningState', { state: 'stopped', reason: 'error', errorCode: 'NETWORK' })
    })

    expect(hook.result.current.state).toBe('idle')
    expect(onFinalText).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/unreachable/i))
  })
})

describe('useVoiceCapture happy path and session end', () => {
  it('start resolving means LISTENING, not end-of-session', async () => {
    const { hook } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))

    await act(() => hook.result.current.start())

    // The old bug: start() resolves immediately in partial mode and the hook
    // treated that as the session being over.
    expect(hook.result.current.state).toBe('listening')
  })

  it('streams partials, then commits the final transcript on stopped', async () => {
    const { hook, onFinalText, onNotice, emit } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
    await act(() => hook.result.current.start())

    act(() => emit('partialResults', { matches: ['buy milk'] }))
    expect(hook.result.current.partial).toBe('buy milk')

    act(() => {
      emit('partialResults', { matches: ['buy milk and bread'] })
      emit('listeningState', { state: 'stopped', reason: 'results' })
    })

    expect(hook.result.current.state).toBe('idle')
    expect(hook.result.current.partial).toBe('')
    expect(onFinalText).toHaveBeenCalledWith('buy milk and bread')
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('silence with no speech yields a notice instead of silent nothing', async () => {
    const { hook, onFinalText, onNotice, emit } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
    await act(() => hook.result.current.start())

    act(() => {
      emit('error', { code: 'SPEECH_TIMEOUT', message: 'No speech input' })
      emit('listeningState', { state: 'stopped', reason: 'silence', errorCode: 'SPEECH_TIMEOUT' })
    })

    expect(hook.result.current.state).toBe('idle')
    expect(onFinalText).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith(expect.stringMatching(/didn't catch that/i))
  })

  it('stop() asks the plugin to stop; the stopped event settles the session', async () => {
    const { hook, plugin, onFinalText, emit } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
    await act(() => hook.result.current.start())

    act(() => emit('partialResults', { matches: ['note to self'] }))
    act(() => hook.result.current.stop())
    expect(plugin.stop).toHaveBeenCalled()

    act(() => {
      emit('listeningState', { state: 'stopped', reason: 'userStop' })
    })
    expect(hook.result.current.state).toBe('idle')
    expect(onFinalText).toHaveBeenCalledWith('note to self')
  })

  it('taps while already listening are ignored (no double session)', async () => {
    const { hook, plugin } = setup()
    await waitFor(() => expect(hook.result.current.state).toBe('idle'))
    await act(() => hook.result.current.start())
    await act(() => hook.result.current.start())
    expect(plugin.start).toHaveBeenCalledTimes(1)
  })
})
