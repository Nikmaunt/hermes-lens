import type { ZodType } from 'zod'
import {
  AgentStatus,
  BriefDetail,
  BriefsResponse,
  CaptureResponse,
  DecisionsResponse,
  DocumentsResponse,
  FlagResponse,
  FollowupActionResponse,
  HabitsResponse,
  HabitTickResponse,
  InboxResponse,
  MemoryResponse,
  PeopleResponse,
  PolishWordsResponse,
  ProjectsResponse,
  RemindersResponse,
  SearchResponse,
  SyncAckResponse,
  TimelineResponse,
  TodaySummary,
  TriageResponse,
  UntriageResponse,
  type CaptureRequest,
  type FlagRequest,
  type FollowupActionRequest,
  type FollowupUndoRequest,
  type HabitTickRequest,
  type HabitUndoRequest,
  type SyncAckRequest,
  type TriageRequest,
} from '@/schemas'
import type { DataSource, TimelineParams } from './DataSource'
import { clearAuthFailure, reportAuthFailure } from './authState'
import { recordValidationIssues } from './debugLog'

/**
 * Short on purpose (F2): a dead Tailscale route fails fast and the UI falls
 * back to the offline cache instead of hanging. Inside the tailnet a healthy
 * agent answers in well under a second.
 */
const REQUEST_TIMEOUT_MS = 4_000

/**
 * What went wrong, for UI decisions (F4):
 * - timeout  — the agent host did not answer in time (VPN off, host asleep)
 * - network  — request never completed (offline, DNS, connection refused)
 * - auth     — the agent answered 401/403: the token is wrong or revoked
 * - server   — the agent answered with any other non-2xx status
 * - invalid  — the payload arrived but failed schema validation
 */
export type ApiErrorKind = 'timeout' | 'network' | 'auth' | 'server' | 'invalid'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind = 'network',
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Talks to the Hermes Agent's read-only JSON API over Tailscale.
 * Every response is zod-validated; the token travels only in the
 * Authorization header and is never logged.
 */
export class ApiDataSource implements DataSource {
  readonly kind = 'api' as const

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async request<T>(schema: ZodType<T>, path: string, body?: unknown): Promise<T> {
    const url = this.baseUrl.replace(/\/+$/, '') + path
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch {
      throw timedOut
        ? new ApiError('Agent timed out', 'timeout')
        : new ApiError('Agent unreachable', 'network')
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        reportAuthFailure()
        throw new ApiError(`Agent returned ${res.status}`, 'auth', res.status)
      }
      throw new ApiError(`Agent returned ${res.status}`, 'server', res.status)
    }
    clearAuthFailure()
    const json: unknown = await res.json()
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      recordValidationIssues(
        path,
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      )
      throw new ApiError(`Invalid payload from ${path}`, 'invalid')
    }
    return parsed.data
  }

  getStatus(): Promise<AgentStatus> {
    return this.request(AgentStatus, '/api/status')
  }

  getToday(): Promise<TodaySummary> {
    return this.request(TodaySummary, '/api/today')
  }

  getTimeline(params?: TimelineParams): Promise<TimelineResponse> {
    const qs = new URLSearchParams()
    if (params?.category) qs.set('category', params.category)
    if (params?.before) qs.set('before', params.before)
    const suffix = qs.size > 0 ? `?${qs.toString()}` : ''
    return this.request(TimelineResponse, `/api/timeline${suffix}`)
  }

  getMemory(): Promise<MemoryResponse> {
    return this.request(MemoryResponse, '/api/memory')
  }

  getProjects(): Promise<ProjectsResponse> {
    return this.request(ProjectsResponse, '/api/projects')
  }

  getPeople(): Promise<PeopleResponse> {
    return this.request(PeopleResponse, '/api/people')
  }

  getDocuments(): Promise<DocumentsResponse> {
    return this.request(DocumentsResponse, '/api/documents')
  }

  getDecisions(projectId?: string): Promise<DecisionsResponse> {
    const suffix = projectId ? `?project=${encodeURIComponent(projectId)}` : ''
    return this.request(DecisionsResponse, `/api/decisions${suffix}`)
  }

  getHabits(): Promise<HabitsResponse> {
    return this.request(HabitsResponse, '/api/habits')
  }

  getPolishWords(): Promise<PolishWordsResponse> {
    return this.request(PolishWordsResponse, '/api/polish-words')
  }

  getInbox(): Promise<InboxResponse> {
    return this.request(InboxResponse, '/api/inbox')
  }

  getReminders(): Promise<RemindersResponse> {
    return this.request(RemindersResponse, '/api/reminders')
  }

  getBriefs(): Promise<BriefsResponse> {
    return this.request(BriefsResponse, '/api/briefs')
  }

  getBrief(id: string): Promise<BriefDetail> {
    return this.request(BriefDetail, `/api/briefs/${encodeURIComponent(id)}`)
  }

  search(query: string): Promise<SearchResponse> {
    return this.request(SearchResponse, `/api/search?q=${encodeURIComponent(query)}`)
  }

  capture(req: CaptureRequest): Promise<CaptureResponse> {
    return this.request(CaptureResponse, '/api/capture', req)
  }

  triage(itemId: string, req: TriageRequest): Promise<TriageResponse> {
    return this.request(TriageResponse, `/api/inbox/${encodeURIComponent(itemId)}/triage`, req)
  }

  flagMemory(itemId: string, req: FlagRequest): Promise<FlagResponse> {
    return this.request(FlagResponse, `/api/memory/${encodeURIComponent(itemId)}/flag`, req)
  }

  followupAction(itemId: string, req: FollowupActionRequest): Promise<FollowupActionResponse> {
    return this.request(
      FollowupActionResponse,
      `/api/followups/${encodeURIComponent(itemId)}/action`,
      req,
    )
  }

  tickHabit(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse> {
    return this.request(HabitTickResponse, `/api/habits/${encodeURIComponent(itemId)}/tick`, req)
  }

  ackSync(req: SyncAckRequest): Promise<SyncAckResponse> {
    return this.request(SyncAckResponse, '/api/sync/ack', req)
  }

  undoFollowupAction(itemId: string): Promise<FollowupActionResponse> {
    const body: FollowupUndoRequest = { action: 'undo' }
    return this.request(
      FollowupActionResponse,
      `/api/followups/${encodeURIComponent(itemId)}/action`,
      body,
    )
  }

  undoHabitTick(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse> {
    const body: HabitUndoRequest = { date: req.date, undo: true }
    return this.request(HabitTickResponse, `/api/habits/${encodeURIComponent(itemId)}/tick`, body)
  }

  untriage(itemId: string): Promise<UntriageResponse> {
    return this.request(UntriageResponse, `/api/inbox/${encodeURIComponent(itemId)}/untriage`, {})
  }
}
