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

  it('search finds items across collections and groups them', async () => {
    const res = await ds.search('spanish')
    expect(res.groups.length).toBeGreaterThan(1)
    for (const group of res.groups) expect(group.results.length).toBeGreaterThan(0)
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
