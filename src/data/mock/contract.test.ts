import { describe, expect, it } from 'vitest'
import { MemoryKV } from '../kv'
import { MockDataSource } from '../MockDataSource'

/*
 * Contract test: every fixture must survive materialization and parse through
 * the same zod schemas the API contract is defined by. If a fixture or schema
 * drifts, this fails loudly — keeping API-CONTRACT.md, schemas and mock data
 * consistent by construction.
 */
describe('mock fixtures honor the API contract', () => {
  // Schema validation happens in the constructor; latency 0 keeps tests fast.
  const ds = new MockDataSource(new MemoryKV(), 0)

  it('parses all read endpoints', async () => {
    const [status, today, timeline, memory, projects, people, documents, decisions, habits, words, inbox] =
      await Promise.all([
        ds.getStatus(),
        ds.getToday(),
        ds.getTimeline(),
        ds.getMemory(),
        ds.getProjects(),
        ds.getPeople(),
        ds.getDocuments(),
        ds.getDecisions(),
        ds.getHabits(),
        ds.getPolishWords(),
        ds.getInbox(),
      ])

    expect(status.gateway.alive).toBe(true)
    expect(today.followUps.length).toBeGreaterThan(0)
    expect(today.inboxCount).toBe(inbox.items.length)
    expect(timeline.events.length).toBeGreaterThan(0)
    expect(memory.items.length).toBeGreaterThanOrEqual(20)
    expect(projects.projects.length).toBeGreaterThanOrEqual(3)
    expect(people.people.length).toBeGreaterThanOrEqual(4)
    expect(documents.items.length).toBeGreaterThanOrEqual(6)
    expect(documents.monthlyTotal.length).toBeGreaterThan(0)
    expect(decisions.decisions.length).toBeGreaterThanOrEqual(5)
    expect(habits.habits.length).toBeGreaterThanOrEqual(3)
    expect(words.words.length).toBeGreaterThanOrEqual(50)
    expect(inbox.items.length).toBeGreaterThan(0)
  })

  it('covers ≥ 3 weeks of timeline history across pages', async () => {
    const all = []
    let before: string | undefined
    for (;;) {
      const page = await ds.getTimeline(before === undefined ? undefined : { before })
      all.push(...page.events)
      if (page.nextBefore === null) break
      before = page.nextBefore
    }
    const oldest = new Date(all[all.length - 1]?.at ?? '').getTime()
    const newest = new Date(all[0]?.at ?? '').getTime()
    expect(newest - oldest).toBeGreaterThanOrEqual(21 * 86_400_000)
  })

  it('mutations behave like the contract says', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const before = (await fresh.getInbox()).items.length

    const cap = await fresh.capture({ text: 'test note', tags: ['t'] })
    expect(cap.status).toBe('ok')
    expect((await fresh.getInbox()).items.length).toBe(before + 1)

    const triaged = await fresh.triage(cap.id, { destination: 'archive' })
    expect(triaged.itemId).toBe(cap.id)
    expect((await fresh.getInbox()).items.length).toBe(before)

    const flag = await fresh.flagMemory('mem-coffee', { action: 'mark-sensitive' })
    expect(flag.status).toBe('pending')
    const memory = await fresh.getMemory()
    expect(memory.items.find((m) => m.id === 'mem-coffee')?.pendingFlag?.action).toBe(
      'mark-sensitive',
    )
  })

  it('parses the reminders feed with a revision and future due dates', async () => {
    const reminders = await ds.getReminders()
    expect(reminders.revision.length).toBeGreaterThan(0)
    expect(reminders.items.length).toBeGreaterThanOrEqual(3)
    expect(reminders.items.some((r) => r.critical)).toBe(true)
    for (const item of reminders.items) {
      expect(new Date(item.dueAt).getTime()).toBeGreaterThan(Date.now())
    }
  })

  it('deduplicates captures replayed with the same clientId (F6)', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const before = (await fresh.getInbox()).items.length

    const first = await fresh.capture({ text: 'offline note', tags: [], clientId: 'cli-1' })
    const replay = await fresh.capture({ text: 'offline note', tags: [], clientId: 'cli-1' })

    expect(replay).toEqual(first) // same response, no second item
    expect((await fresh.getInbox()).items.length).toBe(before + 1)

    // Distinct clientIds (and captures without one) still create items.
    await fresh.capture({ text: 'other note', tags: [], clientId: 'cli-2' })
    await fresh.capture({ text: 'anonymous note', tags: [] })
    expect((await fresh.getInbox()).items.length).toBe(before + 3)
  })

  it('acknowledges reminder syncs idempotently', async () => {
    const req = { syncedAt: '2026-07-04T12:00:00+02:00', lastSeenRevision: 'rev-2b7f31' }
    expect(await ds.ackSync(req)).toEqual({ status: 'ok' })
    expect(await ds.ackSync(req)).toEqual({ status: 'ok' }) // replay is safe
  })

  it('search finds items across collections and groups them', async () => {
    const res = await ds.search('spanish')
    expect(res.groups.length).toBeGreaterThan(1)
    for (const group of res.groups) expect(group.results.length).toBeGreaterThan(0)
  })

  it('timeline never exposes the content of sensitive memory facts', async () => {
    // Sensitive facts are gated behind biometrics on the Memory screen, but
    // timeline events that reference them (relatedId) are rendered — and
    // searched — without any confirmation. Such events may name the topic,
    // never the fact's content: no detail text, no numbers in the title.
    const memory = await ds.getMemory()
    const sensitiveIds = new Set(
      memory.items.filter((m) => m.sensitivity === 'sensitive').map((m) => m.id),
    )

    const events = []
    let before: string | undefined
    for (;;) {
      const page = await ds.getTimeline(before === undefined ? undefined : { before })
      events.push(...page.events)
      if (page.nextBefore === null) break
      before = page.nextBefore
    }

    const related = events.filter((e) => e.relatedId !== null && sensitiveIds.has(e.relatedId))
    expect(related.length).toBeGreaterThan(0) // the rule must actually be exercised
    for (const event of related) {
      expect(event.detail).toBeNull()
      expect(event.title).not.toMatch(/\d/)
    }

    // And the content must not surface through search snippets either.
    for (const probe of ['count double', '4 000', '560 km']) {
      const res = await ds.search(probe)
      const flat = JSON.stringify(res.groups).toLowerCase()
      expect(flat).not.toContain('300 pln/month')
      expect(flat).not.toContain('4 000 usd')
      expect(flat).not.toContain('560 km')
    }
  })

  it('search never leaks sensitive memory content', async () => {
    // "refill" appears only inside a sensitive fact (not in any topic) —
    // content of sensitive items must not be searchable at all.
    const byContent = await ds.search('refill')
    expect(byContent.groups.find((g) => g.kind === 'memory')).toBeUndefined()

    // Matching the topic is fine, but the snippet must be empty and flagged.
    const byTopic = await ds.search('budget')
    const memoryGroup = byTopic.groups.find((g) => g.kind === 'memory')
    for (const result of memoryGroup?.results ?? []) {
      if (result.sensitive) expect(result.snippet).toBe('')
    }
    const flat = JSON.stringify(byTopic.groups)
    expect(flat).not.toContain('95 USD') // content of the sensitive budget fact
  })
})
