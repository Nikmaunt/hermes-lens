import {
  AgentStatus,
  BriefDetail,
  BriefsResponse,
  CaptureRequest,
  CaptureResponse,
  DecisionsResponse,
  DocumentsResponse,
  FlagRequest,
  FlagResponse,
  FollowupActionRequest,
  FollowupActionResponse,
  FollowUpPendingAction,
  HabitsResponse,
  HabitTickRequest,
  HabitTickResponse,
  InboxItem,
  InboxResponse,
  MemoryItem,
  MemoryResponse,
  Money,
  PeopleResponse,
  PolishWordsResponse,
  ProjectsResponse,
  RemindersResponse,
  SearchResponse,
  SearchResult,
  SearchResultKind,
  SyncAckRequest,
  SyncAckResponse,
  TimelineResponse,
  TodaySummary,
  TriageRequest,
  TriageResponse,
  UpcomingDeadline,
  FollowUp,
} from '@/schemas'
import { z } from 'zod'
import { daysUntil, toIsoDate, toIsoDateTime } from '@/lib/dates'
import type { DataSource, TimelineParams } from './DataSource'
import type { KV } from './kv'
import { materialize } from './mock/materialize'
import statusFixture from './mock/fixtures/status.json'
import todayFixture from './mock/fixtures/today.json'
import timelineFixture from './mock/fixtures/timeline.json'
import memoryFixture from './mock/fixtures/memory.json'
import projectsFixture from './mock/fixtures/projects.json'
import peopleFixture from './mock/fixtures/people.json'
import documentsFixture from './mock/fixtures/documents.json'
import decisionsFixture from './mock/fixtures/decisions.json'
import habitsFixture from './mock/fixtures/habits.json'
import polishFixture from './mock/fixtures/polish-words.json'
import inboxFixture from './mock/fixtures/inbox.json'
import remindersFixture from './mock/fixtures/reminders.json'
import briefsFixture from './mock/fixtures/briefs.json'

const TIMELINE_PAGE_SIZE = 25

/** User actions replayed on top of the fixtures so they survive restarts. */
interface MockOverlay {
  capturedItems: InboxItem[]
  triagedIds: string[]
  flags: Record<string, { action: 'forget' | 'mark-sensitive'; requestedAt: string }>
  /** clientId → response of the first capture, for offline-replay dedup. */
  captureClientIds: Record<string, CaptureResponse>
  /** followUpId → queued done/snooze, mirroring the server's pendingAction. */
  followupActions: Record<string, FollowUpPendingAction>
  /** habitId → extra completed dates ticked from the app. */
  habitTicks: Record<string, string[]>
}

const EMPTY_OVERLAY: MockOverlay = {
  capturedItems: [],
  triagedIds: [],
  flags: {},
  captureClientIds: {},
  followupActions: {},
  habitTicks: {},
}
const OVERLAY_KEY = 'mock:overlay'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Serves the bundled fixture dataset. Fixture dates are stored as offsets
 * ("@d-3") and materialized against the real clock at construction, so the
 * three weeks of history always end "today".
 */
export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const

  private overlay: MockOverlay = EMPTY_OVERLAY
  private overlayLoaded: Promise<void>

  private status: AgentStatus
  private followUps: FollowUp[]
  private timeline: TimelineResponse
  private memory: MemoryResponse
  private projects: ProjectsResponse
  private people: PeopleResponse
  private documents: DocumentsResponse['items']
  private decisions: DecisionsResponse
  private habits: HabitsResponse
  private polishWords: PolishWordsResponse
  private inboxItems: InboxItem[]
  private reminders: RemindersResponse
  private briefs: BriefDetail[]
  private todayBrief: TodaySummary['brief']
  private spentThisMonth: Money[] | undefined

  constructor(
    private kv: KV,
    private latencyMs = 250,
    now = new Date(),
  ) {
    // Fixtures are validated through the same zod schemas as API responses,
    // so contract drift fails loudly instead of rendering garbage.
    this.status = AgentStatus.parse(materialize(statusFixture, now))
    this.followUps = z.array(FollowUp).parse(materialize(todayFixture.followUps, now))
    this.timeline = TimelineResponse.parse(materialize(timelineFixture, now))
    this.memory = MemoryResponse.parse(materialize(memoryFixture, now))
    this.projects = ProjectsResponse.parse(materialize(projectsFixture, now))
    this.people = PeopleResponse.parse(materialize(peopleFixture, now))
    this.documents = DocumentsResponse.shape.items.parse(
      materialize(documentsFixture.items, now),
    )
    this.decisions = DecisionsResponse.parse(materialize(decisionsFixture, now))
    this.habits = HabitsResponse.parse(materialize(habitsFixture, now))
    this.polishWords = PolishWordsResponse.parse(materialize(polishFixture, now))
    this.inboxItems = InboxResponse.shape.items.parse(materialize(inboxFixture.items, now))
    this.reminders = RemindersResponse.parse(materialize(remindersFixture, now))
    this.briefs = z.array(BriefDetail).parse(materialize(briefsFixture.briefs, now))
    this.todayBrief = TodaySummary.shape.brief.parse(materialize(todayFixture.brief, now))
    this.spentThisMonth = DocumentsResponse.shape.spentThisMonth.parse(
      documentsFixture.spentThisMonth,
    )
    this.overlayLoaded = this.loadOverlay()
  }

  private async loadOverlay(): Promise<void> {
    const raw = await this.kv.get(OVERLAY_KEY)
    if (raw === null) return
    try {
      this.overlay = { ...EMPTY_OVERLAY, ...(JSON.parse(raw) as MockOverlay) }
    } catch {
      this.overlay = EMPTY_OVERLAY
    }
  }

  private async saveOverlay(): Promise<void> {
    await this.kv.set(OVERLAY_KEY, JSON.stringify(this.overlay))
  }

  private async ready(): Promise<void> {
    await this.overlayLoaded
    await sleep(this.latencyMs + Math.random() * 150)
  }

  private currentInbox(): InboxItem[] {
    const triaged = new Set(this.overlay.triagedIds)
    return [...this.inboxItems, ...this.overlay.capturedItems].filter(
      (item) => !triaged.has(item.id),
    )
  }

  private currentMemory(): MemoryItem[] {
    return this.memory.items.map((item) => {
      const flag = this.overlay.flags[item.id]
      return flag
        ? { ...item, pendingFlag: { ...flag, status: 'pending' as const } }
        : item
    })
  }

  async getStatus(): Promise<AgentStatus> {
    await this.ready()
    return this.status
  }

  async getToday(): Promise<TodaySummary> {
    await this.ready()
    const now = new Date()
    const deadlines: UpcomingDeadline[] = []
    for (const doc of this.documents) {
      const kind = doc.kind === 'subscription' ? ('subscription' as const) : ('document' as const)
      if (doc.cancelBy !== null && daysUntil(doc.cancelBy, now) >= 0 && daysUntil(doc.cancelBy, now) <= 30) {
        deadlines.push({
          id: `${doc.id}-cancel`,
          title: `Cancel window: ${doc.title}`,
          date: doc.cancelBy,
          kind,
          daysLeft: daysUntil(doc.cancelBy, now),
        })
      } else if (doc.renewsOn !== null && daysUntil(doc.renewsOn, now) >= 0 && daysUntil(doc.renewsOn, now) <= 30) {
        deadlines.push({
          id: `${doc.id}-renew`,
          title: `Renews: ${doc.title}`,
          date: doc.renewsOn,
          kind,
          daysLeft: daysUntil(doc.renewsOn, now),
        })
      }
    }
    deadlines.sort((a, b) => a.daysLeft - b.daysLeft)

    const dayAgo = now.getTime() - 86_400_000
    const agentActivity = this.timeline.events
      .filter((e) => new Date(e.at).getTime() >= dayAgo)
      .map((e) => ({ id: e.id, at: e.at, summary: e.title, category: e.category }))

    // Server behavior: queued done/snooze actions surface as pendingAction.
    const followUps = this.followUps.map((fu) => {
      const pending = this.overlay.followupActions[fu.id]
      return pending === undefined ? fu : { ...fu, pendingAction: pending }
    })

    return {
      date: toIsoDate(now),
      followUps,
      deadlines,
      agentActivity,
      inboxCount: this.currentInbox().length,
      generatedAt: toIsoDateTime(now),
      ...(this.todayBrief === undefined ? {} : { brief: this.todayBrief }),
    }
  }

  async getTimeline(params?: TimelineParams): Promise<TimelineResponse> {
    await this.ready()
    let events = this.timeline.events
    if (params?.category) events = events.filter((e) => e.category === params.category)
    if (params?.before) {
      const cutoff = new Date(params.before).getTime()
      events = events.filter((e) => new Date(e.at).getTime() < cutoff)
    }
    const page = events.slice(0, TIMELINE_PAGE_SIZE)
    const last = page[page.length - 1]
    return {
      events: page,
      nextBefore: events.length > TIMELINE_PAGE_SIZE && last ? last.at : null,
    }
  }

  async getMemory(): Promise<MemoryResponse> {
    await this.ready()
    return { items: this.currentMemory() }
  }

  async getProjects(): Promise<ProjectsResponse> {
    await this.ready()
    return this.projects
  }

  async getPeople(): Promise<PeopleResponse> {
    await this.ready()
    return this.people
  }

  async getDocuments(): Promise<DocumentsResponse> {
    await this.ready()
    const totals = new Map<string, number>()
    for (const doc of this.documents) {
      if (doc.amount === null || doc.billingPeriod === null) continue
      const perMonth =
        doc.billingPeriod === 'monthly' ? doc.amount.cents : Math.round(doc.amount.cents / 12)
      totals.set(doc.amount.currency, (totals.get(doc.amount.currency) ?? 0) + perMonth)
    }
    const monthlyTotal: Money[] = [...totals.entries()].map(([currency, cents]) =>
      Money.parse({ currency, cents }),
    )
    return {
      items: this.documents,
      monthlyTotal,
      ...(this.spentThisMonth === undefined ? {} : { spentThisMonth: this.spentThisMonth }),
    }
  }

  async getDecisions(projectId?: string): Promise<DecisionsResponse> {
    await this.ready()
    const decisions = projectId
      ? this.decisions.decisions.filter((d) => d.projectId === projectId)
      : this.decisions.decisions
    return { decisions }
  }

  async getHabits(): Promise<HabitsResponse> {
    await this.ready()
    // Server behavior: pending ticks are unioned into completedDates.
    const habits = this.habits.habits.map((habit) => {
      const ticks = this.overlay.habitTicks[habit.id]
      if (ticks === undefined || ticks.length === 0) return habit
      const merged = [...new Set([...habit.completedDates, ...ticks])].sort()
      return { ...habit, completedDates: merged }
    })
    return { habits, generatedAt: this.habits.generatedAt }
  }

  async getPolishWords(): Promise<PolishWordsResponse> {
    await this.ready()
    return this.polishWords
  }

  async getInbox(): Promise<InboxResponse> {
    await this.ready()
    return { items: this.currentInbox() }
  }

  async getReminders(): Promise<RemindersResponse> {
    await this.ready()
    return this.reminders
  }

  async getBriefs(): Promise<BriefsResponse> {
    await this.ready()
    const items = [...this.briefs]
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .map(({ id, date, title, kind }) => ({ id, date, title, kind }))
    return { items }
  }

  async getBrief(id: string): Promise<BriefDetail> {
    await this.ready()
    const brief = this.briefs.find((b) => b.id === id)
    // Mirrors the server's 404 on an unknown id.
    if (brief === undefined) throw new Error(`Brief not found: ${id}`)
    return brief
  }

  async search(query: string): Promise<SearchResponse> {
    await this.ready()
    const q = query.trim().toLowerCase()
    if (q.length === 0) return { query, groups: [] }

    const snippet = (text: string): string => {
      const idx = text.toLowerCase().indexOf(q)
      if (idx < 0) return text.slice(0, 90)
      const start = Math.max(0, idx - 30)
      return (start > 0 ? '…' : '') + text.slice(start, start + 90)
    }
    const match = (...fields: (string | null)[]): boolean =>
      fields.some((f) => f !== null && f.toLowerCase().includes(q))

    const groups: { kind: SearchResultKind; results: SearchResult[] }[] = []
    const add = (kind: SearchResultKind, results: SearchResult[]): void => {
      if (results.length > 0) groups.push({ kind, results })
    }

    add(
      'memory',
      this.currentMemory()
        // Sensitive facts are gated behind biometrics on the Memory screen;
        // search must neither match on nor leak their content.
        .filter((m) =>
          m.sensitivity === 'sensitive' ? match(m.topic) : match(m.fact, m.topic),
        )
        .map((m) =>
          m.sensitivity === 'sensitive'
            ? { id: m.id, title: m.topic, snippet: '', sensitive: true }
            : { id: m.id, title: m.topic, snippet: snippet(m.fact), sensitive: false },
        ),
    )
    add(
      'people',
      this.people.people
        .filter((p) => match(p.name, p.relation, p.context))
        .map((p) => ({ id: p.id, title: p.name, snippet: snippet(p.context), sensitive: false })),
    )
    add(
      'projects',
      this.projects.projects
        .filter((p) => match(p.name, p.summary, p.nextAction))
        .map((p) => ({ id: p.id, title: p.name, snippet: snippet(p.summary), sensitive: false })),
    )
    add(
      'decisions',
      this.decisions.decisions
        .filter((d) => match(d.title, d.context, d.reasoning))
        .map((d) => ({ id: d.id, title: d.title, snippet: snippet(d.context), sensitive: false })),
    )
    add(
      'timeline',
      this.timeline.events
        .filter((e) => match(e.title, e.detail))
        .map((e) => ({
          id: e.id,
          title: e.title,
          snippet: snippet(e.detail ?? e.title),
          sensitive: false,
        })),
    )
    add(
      'documents',
      this.documents
        .filter((d) => match(d.title, d.provider, d.notes))
        .map((d) => ({
          id: d.id,
          title: d.title,
          snippet: snippet(d.notes ?? d.provider),
          sensitive: false,
        })),
    )
    add(
      'inbox',
      this.currentInbox()
        .filter((i) => match(i.text, i.tags.join(' ')))
        .map((i) => ({
          id: i.id,
          title: snippet(i.text),
          snippet: i.tags.join(', '),
          sensitive: false,
        })),
    )

    return { query, groups }
  }

  async capture(req: CaptureRequest): Promise<CaptureResponse> {
    await this.ready()
    // Idempotent replay: a clientId we have already accepted returns the
    // original response instead of creating a duplicate inbox item —
    // mirroring the server-side dedup contract (F6).
    if (req.clientId !== undefined) {
      const previous = this.overlay.captureClientIds[req.clientId]
      if (previous !== undefined) return previous
    }
    const now = new Date()
    const item: InboxItem = {
      id: `cap-${now.getTime()}`,
      text: req.text,
      capturedAt: toIsoDateTime(now),
      source: 'capture',
      tags: req.tags,
    }
    this.overlay.capturedItems.push(item)
    const response: CaptureResponse = { status: 'ok', id: item.id, capturedAt: item.capturedAt }
    if (req.clientId !== undefined) this.overlay.captureClientIds[req.clientId] = response
    await this.saveOverlay()
    return response
  }

  async triage(itemId: string, _req: TriageRequest): Promise<TriageResponse> {
    await this.ready()
    if (!this.overlay.triagedIds.includes(itemId)) this.overlay.triagedIds.push(itemId)
    await this.saveOverlay()
    return { status: 'ok', itemId }
  }

  async flagMemory(itemId: string, req: FlagRequest): Promise<FlagResponse> {
    await this.ready()
    this.overlay.flags[itemId] = { action: req.action, requestedAt: toIsoDateTime(new Date()) }
    await this.saveOverlay()
    return { status: 'pending', itemId }
  }

  async followupAction(
    itemId: string,
    req: FollowupActionRequest,
  ): Promise<FollowupActionResponse> {
    await this.ready()
    // The agent already resolved (or never had) this item: success-by-staleness.
    if (!this.followUps.some((fu) => fu.id === itemId)) return { status: 'gone', itemId }
    // While an action is pending the server ignores further ones — so does the mock.
    if (this.overlay.followupActions[itemId] === undefined) {
      this.overlay.followupActions[itemId] = {
        action: req.action,
        ...(req.until === undefined ? {} : { until: req.until }),
        requestedAt: toIsoDateTime(new Date()),
      }
      await this.saveOverlay()
    }
    return { status: 'ok', itemId }
  }

  async tickHabit(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse> {
    await this.ready()
    if (!this.habits.habits.some((h) => h.id === itemId)) return { status: 'gone', itemId }
    // Idempotent: replaying the same date (offline queue) is a no-op success.
    const ticks = this.overlay.habitTicks[itemId] ?? []
    if (!ticks.includes(req.date)) {
      this.overlay.habitTicks[itemId] = [...ticks, req.date]
      await this.saveOverlay()
    }
    return { status: 'ok', itemId }
  }

  async ackSync(_req: SyncAckRequest): Promise<SyncAckResponse> {
    await this.ready()
    // Idempotent by construction: acknowledging a revision is a no-op here.
    return { status: 'ok' }
  }
}
