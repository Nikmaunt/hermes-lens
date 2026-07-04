import type {
  AgentStatus,
  CaptureRequest,
  CaptureResponse,
  DecisionsResponse,
  DocumentsResponse,
  EventCategory,
  FlagRequest,
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
  TriageRequest,
  TriageResponse,
} from '@/schemas'

export interface TimelineParams {
  category?: EventCategory
  before?: string
}

/**
 * The single seam between the UI and the agent's brain.
 * MockDataSource serves bundled fixtures; ApiDataSource talks to the VPS.
 * The UI must never know which one is active.
 */
export interface DataSource {
  readonly kind: 'mock' | 'api'

  getStatus(): Promise<AgentStatus>
  getToday(): Promise<TodaySummary>
  getTimeline(params?: TimelineParams): Promise<TimelineResponse>
  getMemory(): Promise<MemoryResponse>
  getProjects(): Promise<ProjectsResponse>
  getPeople(): Promise<PeopleResponse>
  getDocuments(): Promise<DocumentsResponse>
  getDecisions(projectId?: string): Promise<DecisionsResponse>
  getHabits(): Promise<HabitsResponse>
  getPolishWords(): Promise<PolishWordsResponse>
  getInbox(): Promise<InboxResponse>
  search(query: string): Promise<SearchResponse>

  capture(req: CaptureRequest): Promise<CaptureResponse>
  triage(itemId: string, req: TriageRequest): Promise<TriageResponse>
  flagMemory(itemId: string, req: FlagRequest): Promise<FlagResponse>
}
