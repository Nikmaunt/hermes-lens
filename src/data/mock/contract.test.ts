import { describe, expect, it } from 'vitest'
import { FollowupActionResponse, HabitTickResponse, UntriageResponse } from '@/schemas'
import { MemoryKV } from '../kv'
import { MockDataSource } from '../MockDataSource'
import undoResponsesFixture from './fixtures/undo-responses.json'
import { toIsoDate } from '@/lib/dates'

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

  it('answers notification capture replays with "duplicate" and the original itemId', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const req = {
      clientId: 'client-1-stable',
      package: 'com.whatsapp',
      postedAt: '2026-07-11T09:30:00+02:00',
      capturedAt: '2026-07-11T09:30:02+02:00',
      title: 'Maria',
      text: 'Are we still on for tomorrow?',
    }

    const first = await fresh.captureNotification(req)
    expect(first.status).toBe('ok')

    const replay = await fresh.captureNotification(req)
    expect(replay.status).toBe('duplicate')
    expect(replay.itemId).toBe(first.itemId)

    // A different clientId is a different notification.
    const other = await fresh.captureNotification({ ...req, clientId: 'client-2-stable' })
    expect(other.status).toBe('ok')
    expect(other.itemId).not.toBe(first.itemId)
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

  it('serves briefs that honor the contract, newest first, with today wired up', async () => {
    const briefs = await ds.getBriefs()
    expect(briefs.items.length).toBeGreaterThanOrEqual(3)
    const dates = briefs.items.map((b) => b.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(briefs.items.some((b) => b.kind === 'adhoc')).toBe(true)

    // Every listed brief opens as a full detail with markdown.
    for (const item of briefs.items) {
      const detail = await ds.getBrief(item.id)
      expect(detail.id).toBe(item.id)
      expect(detail.markdown.length).toBeGreaterThan(0)
    }

    // Today points at an existing morning brief (Demo mode must exercise the card).
    const today = await ds.getToday()
    expect(today.brief).toBeDefined()
    const linked = briefs.items.find((b) => b.id === today.brief?.id)
    expect(linked?.kind).toBe('morning')
  })

  it('rejects an unknown brief id like the server 404s', async () => {
    await expect(ds.getBrief('no-such-brief')).rejects.toThrow()
  })

  it('ships a follow-up with a pendingAction so Demo mode shows the syncing state', async () => {
    const today = await ds.getToday()
    const pending = today.followUps.filter((fu) => fu.pendingAction !== undefined)
    expect(pending.length).toBeGreaterThan(0)
  })

  it('followup action: ok + pendingAction surfaces, repeat snooze ignored, unknown id gone', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const res = await fresh.followupAction('fu-2', { action: 'snooze', until: '2027-01-04' })
    expect(res).toEqual({ status: 'ok', itemId: 'fu-2' })

    const today = await fresh.getToday()
    const fu = today.followUps.find((f) => f.id === 'fu-2')
    expect(fu?.pendingAction?.action).toBe('snooze')
    expect(fu?.pendingAction?.until).toBe('2027-01-04')

    // The server ignores a second action while one is pending — so does the mock.
    await fresh.followupAction('fu-2', { action: 'snooze', until: '2027-02-01' })
    const again = await fresh.getToday()
    expect(again.followUps.find((f) => f.id === 'fu-2')?.pendingAction?.until).toBe('2027-01-04')

    // Offline replay after the agent resolved the item: gone is a success.
    expect(await fresh.followupAction('fu-does-not-exist', { action: 'done' })).toEqual({
      status: 'gone',
      itemId: 'fu-does-not-exist',
    })
  })

  it('habit tick: date unions into completedDates, repeat tick is idempotent, unknown id gone', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const habits = await fresh.getHabits()
    const habit = habits.habits.find((h) => h.id === 'habit-gym')
    expect(habit).toBeDefined()
    const today = toIsoDate(new Date()) // local date — fixtures materialize against the local clock
    expect(habit?.completedDates).not.toContain(today)

    expect(await fresh.tickHabit('habit-gym', { date: today })).toEqual({
      status: 'ok',
      itemId: 'habit-gym',
    })
    const after = await fresh.getHabits()
    const ticked = after.habits.find((h) => h.id === 'habit-gym')?.completedDates ?? []
    expect(ticked).toContain(today)
    expect([...ticked].sort()).toEqual(ticked) // stays ascending

    // Replaying the same tick (offline queue) must not duplicate the date.
    await fresh.tickHabit('habit-gym', { date: today })
    const replayed = await fresh.getHabits()
    const dates = replayed.habits.find((h) => h.id === 'habit-gym')?.completedDates ?? []
    expect(dates.filter((d) => d === today).length).toBe(1)

    expect(await fresh.tickHabit('habit-unknown', { date: today })).toEqual({
      status: 'gone',
      itemId: 'habit-unknown',
    })
  })

  it('documents expose month-to-date spend per currency', async () => {
    const documents = await ds.getDocuments()
    expect(documents.spentThisMonth).toBeDefined()
    expect(documents.spentThisMonth?.length).toBeGreaterThan(0)
    const currencies = documents.spentThisMonth?.map((m) => m.currency) ?? []
    expect(new Set(currencies).size).toBe(currencies.length) // one entry per currency
  })

  it('undo response fixtures parse through the response schemas (ok and gone)', () => {
    for (const key of ['ok', 'gone'] as const) {
      expect(FollowupActionResponse.parse(undoResponsesFixture.followupUndo[key]).status).toBe(key)
      expect(HabitTickResponse.parse(undoResponsesFixture.habitUndo[key]).status).toBe(key)
      expect(UntriageResponse.parse(undoResponsesFixture.untriage[key]).status).toBe(key)
    }
  })

  it('followup undo: cancels a pending action, gone when nothing is pending', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    await fresh.followupAction('fu-2', { action: 'snooze', until: '2027-01-04' })

    expect(await fresh.undoFollowupAction('fu-2')).toEqual({ status: 'ok', itemId: 'fu-2' })
    const today = await fresh.getToday()
    expect(today.followUps.find((f) => f.id === 'fu-2')?.pendingAction).toBeUndefined()

    // Nothing pending anymore: the train has left.
    expect(await fresh.undoFollowupAction('fu-2')).toEqual({ status: 'gone', itemId: 'fu-2' })
    // fu-6 ships with a fixture pendingAction — already processed server-side,
    // not a client-cancellable queue file.
    expect(await fresh.undoFollowupAction('fu-6')).toEqual({ status: 'gone', itemId: 'fu-6' })
  })

  it('habit undo: removes a pending tick, gone for dates already in the habit file', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const today = toIsoDate(new Date()) // local date — fixtures materialize against the local clock
    await fresh.tickHabit('habit-gym', { date: today })

    expect(await fresh.undoHabitTick('habit-gym', { date: today })).toEqual({
      status: 'ok',
      itemId: 'habit-gym',
    })
    const after = await fresh.getHabits()
    expect(after.habits.find((h) => h.id === 'habit-gym')?.completedDates).not.toContain(today)

    // Undoing again: nothing pending.
    expect(await fresh.undoHabitTick('habit-gym', { date: today })).toEqual({
      status: 'gone',
      itemId: 'habit-gym',
    })

    // A date recorded in the habit file itself (fixture history) is not a
    // pending tick — the server refuses and the date stays.
    const fixtureDate = (await fresh.getHabits()).habits.find((h) => h.id === 'habit-gym')
      ?.completedDates[0]
    expect(fixtureDate).toBeDefined()
    expect(await fresh.undoHabitTick('habit-gym', { date: fixtureDate ?? '' })).toEqual({
      status: 'gone',
      itemId: 'habit-gym',
    })
    const still = await fresh.getHabits()
    expect(still.habits.find((h) => h.id === 'habit-gym')?.completedDates).toContain(fixtureDate)
  })

  it('untriage: returns the note to the inbox, gone when it was never (or no longer) triaged', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const first = (await fresh.getInbox()).items[0]
    expect(first).toBeDefined()
    const id = first?.id ?? ''
    await fresh.triage(id, { destination: 'archive' })
    expect((await fresh.getInbox()).items.some((i) => i.id === id)).toBe(false)

    expect(await fresh.untriage(id)).toEqual({ status: 'ok', itemId: id })
    expect((await fresh.getInbox()).items.some((i) => i.id === id)).toBe(true)

    // Second undo has nothing left to cancel.
    expect(await fresh.untriage(id)).toEqual({ status: 'gone', itemId: id })
    expect(await fresh.untriage('in-unknown')).toEqual({ status: 'gone', itemId: 'in-unknown' })
  })

  it('parses the someday list with parked items and a fixture pendingAction', async () => {
    const someday = await ds.getSomeday()
    expect(someday.items.length).toBeGreaterThanOrEqual(2)
    for (const item of someday.items) expect(item.title.length).toBeGreaterThan(0)
    // One item ships pending so Demo mode exercises the syncing treatment.
    expect(someday.items.some((i) => i.pendingAction !== undefined)).toBe(true)
  })

  it('someday action: ok + pendingAction surfaces, repeat ignored, unknown id gone', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const res = await fresh.somedayAction('sd-1', { action: 'activate', date: '2027-01-04' })
    expect(res).toEqual({ status: 'ok', itemId: 'sd-1' })

    const someday = await fresh.getSomeday()
    const item = someday.items.find((i) => i.id === 'sd-1')
    expect(item?.pendingAction?.action).toBe('activate')
    expect(item?.pendingAction?.date).toBe('2027-01-04')

    // The server ignores a second action while one is pending — so does the mock.
    await fresh.somedayAction('sd-1', { action: 'close' })
    const again = await fresh.getSomeday()
    expect(again.items.find((i) => i.id === 'sd-1')?.pendingAction?.action).toBe('activate')

    // Offline replay after the agent resolved the item: gone is a success.
    expect(await fresh.somedayAction('sd-unknown', { action: 'close' })).toEqual({
      status: 'gone',
      itemId: 'sd-unknown',
    })
  })

  it('someday undo: cancels a pending action, gone when nothing is pending', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    await fresh.somedayAction('sd-1', { action: 'close' })

    expect(await fresh.somedayAction('sd-1', { action: 'undo' })).toEqual({
      status: 'ok',
      itemId: 'sd-1',
    })
    const someday = await fresh.getSomeday()
    expect(someday.items.find((i) => i.id === 'sd-1')?.pendingAction).toBeUndefined()

    // Nothing pending anymore: the train has left.
    expect(await fresh.somedayAction('sd-1', { action: 'undo' })).toEqual({
      status: 'gone',
      itemId: 'sd-1',
    })
    // A fixture pendingAction is the server's own queue, already out of reach.
    const pendingFixture = someday.items.find((i) => i.pendingAction !== undefined)
    expect(pendingFixture).toBeDefined()
    expect(await fresh.somedayAction(pendingFixture?.id ?? '', { action: 'undo' })).toEqual({
      status: 'gone',
      itemId: pendingFixture?.id,
    })
  })

  it('runs a deterministic chat turn from running to done (mock)', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const started = await fresh.startChat({ message: 'who am I?', clientId: 'chat-1' })
    expect(started.status).toBe('running')
    expect(started.jobId.length).toBeGreaterThan(0)
    expect(started.sessionId.length).toBeGreaterThan(0)

    // First poll: the agent is still thinking (30–120s live; instant here).
    const first = await fresh.getChatJob(started.jobId)
    expect(first.status).toBe('running')
    expect(first.reply).toBeUndefined()

    // A later poll resolves with the full reply in one shot — no streaming.
    const done = await fresh.getChatJob(started.jobId)
    expect(done.status).toBe('done')
    expect(done.reply).toBeTruthy()
    expect(done.finishedAt).toBeTruthy()
    expect(done.tokensUsed ?? 0).toBeGreaterThan(0) // cost meter present once it ran

    // Polling a resolved job keeps returning the same terminal answer.
    const again = await fresh.getChatJob(started.jobId)
    expect(again).toEqual(done)
  })

  it('deduplicates a chat turn replayed with the same clientId (D-A8)', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const first = await fresh.startChat({ message: 'ping', clientId: 'chat-dup' })
    const replay = await fresh.startChat({ message: 'ping', clientId: 'chat-dup' })
    expect(replay).toEqual(first) // same jobId + sessionId, no second turn started

    // A distinct clientId is a genuinely new turn with its own job.
    const other = await fresh.startChat({ message: 'ping', clientId: 'chat-other' })
    expect(other.jobId).not.toBe(first.jobId)
  })

  it('reuses the sessionId across turns, mints one for the first (D-A7)', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    const first = await fresh.startChat({ message: 'turn one', clientId: 'c1' })
    const second = await fresh.startChat({
      message: 'turn two',
      clientId: 'c2',
      sessionId: first.sessionId,
    })
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.jobId).not.toBe(first.jobId)
  })

  it('rejects an unknown chat jobId like the server 404s', async () => {
    const fresh = new MockDataSource(new MemoryKV(), 0)
    await expect(fresh.getChatJob('job-nope')).rejects.toThrow()
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
