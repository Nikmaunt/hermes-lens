import type { ZodType } from 'zod'
import {
  AgentStatus,
  CaptureResponse,
  DecisionsResponse,
  DocumentsResponse,
  FlagResponse,
  HabitsResponse,
  InboxResponse,
  MemoryResponse,
  PeopleResponse,
  PolishWordsResponse,
  ProjectsResponse,
  SearchResponse,
  TimelineResponse,
  TodaySummary,
  TriageResponse,
  type CaptureRequest,
  type FlagRequest,
  type TriageRequest,
} from '@/schemas'
import type { DataSource, TimelineParams } from './DataSource'

const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
  constructor(
    message: string,
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
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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
      throw new ApiError('Agent unreachable')
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new ApiError(`Agent returned ${res.status}`, res.status)
    const json: unknown = await res.json()
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new ApiError(`Invalid payload from ${path}`)
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
}
