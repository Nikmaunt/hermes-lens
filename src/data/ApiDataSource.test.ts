import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiDataSource, ApiError } from './ApiDataSource'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

function stubFetch(impl: (url: string, init: RequestInit) => unknown) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiDataSource', () => {
  it('sends the bearer token and joins URLs against the base', async () => {
    const spy = stubFetch(() => jsonResponse({ items: [] }))
    const ds = new ApiDataSource('http://hermes-vps:8787/', 'secret-token')
    await ds.getInbox()

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://hermes-vps:8787/api/inbox')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
    expect(init.method).toBe('GET')
  })

  it('encodes query params for search and timeline', async () => {
    const spy = stubFetch(() => jsonResponse({ query: 'a b', groups: [] }))
    const ds = new ApiDataSource('http://x', 't')
    await ds.search('a b')
    expect((spy.mock.calls[0] as [string, RequestInit])[0]).toBe('http://x/api/search?q=a%20b')

    spy.mockImplementation(() => jsonResponse({ events: [], nextBefore: null }))
    await ds.getTimeline({ category: 'agent', before: '2026-07-01T00:00:00+02:00' })
    const url = (spy.mock.calls[1] as [string, RequestInit])[0]
    expect(url).toContain('/api/timeline?category=agent&before=2026-07-01T00%3A00%3A00%2B02%3A00')
  })

  it('POSTs JSON bodies for writes', async () => {
    const spy = stubFetch(() => jsonResponse({ status: 'ok', itemId: 'in-1' }))
    const ds = new ApiDataSource('http://x', 't')
    await ds.triage('in-1', { destination: 'note' })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/api/inbox/in-1/triage')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ destination: 'note' }))
  })

  it('POSTs {action:"undo"} to the followup action endpoint', async () => {
    const spy = stubFetch(() => jsonResponse({ status: 'ok', itemId: 'fu-2' }))
    const ds = new ApiDataSource('http://x', 't')
    const res = await ds.undoFollowupAction('fu-2')

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/api/followups/fu-2/action')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ action: 'undo' }))
    expect(res).toEqual({ status: 'ok', itemId: 'fu-2' })
  })

  it('POSTs {date, undo:true} to the habit tick endpoint', async () => {
    const spy = stubFetch(() => jsonResponse({ status: 'gone', itemId: 'habit-gym' }))
    const ds = new ApiDataSource('http://x', 't')
    const res = await ds.undoHabitTick('habit-gym', { date: '2026-07-05' })

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/api/habits/habit-gym/tick')
    expect(init.body).toBe(JSON.stringify({ date: '2026-07-05', undo: true }))
    expect(res).toEqual({ status: 'gone', itemId: 'habit-gym' })
  })

  it('POSTs an empty body to the untriage endpoint', async () => {
    const spy = stubFetch(() => jsonResponse({ status: 'ok', itemId: 'in-1' }))
    const ds = new ApiDataSource('http://x', 't')
    const res = await ds.untriage('in-1')

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/api/inbox/in-1/untriage')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({}))
    expect(res).toEqual({ status: 'ok', itemId: 'in-1' })
  })

  it('throws ApiError with the status on non-2xx', async () => {
    stubFetch(() => jsonResponse({ error: 'nope' }, false, 401))
    const ds = new ApiDataSource('http://x', 'bad')
    const err = await ds.getInbox().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  })

  it('rejects payloads that fail schema validation', async () => {
    stubFetch(() => jsonResponse({ items: [{ id: 42 }] })) // id must be a string
    const ds = new ApiDataSource('http://x', 't')
    await expect(ds.getInbox()).rejects.toThrow(/Invalid payload/)
  })

  it('maps network failures to "Agent unreachable"', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')))
    const ds = new ApiDataSource('http://x', 't')
    await expect(ds.getStatus()).rejects.toThrow('Agent unreachable')
  })
})
