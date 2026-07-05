import type {
  AgentStatus,
  BriefDetail,
  BriefsResponse,
  CaptureRequest,
  CaptureResponse,
  DecisionsResponse,
  DocumentsResponse,
  EventCategory,
  FlagRequest,
  FlagResponse,
  FollowupActionRequest,
  FollowupActionResponse,
  HabitsResponse,
  HabitTickRequest,
  HabitTickResponse,
  InboxResponse,
  MemoryResponse,
  PeopleResponse,
  PolishWordsResponse,
  ProjectsResponse,
  RemindersResponse,
  SearchResponse,
  SyncAckRequest,
  SyncAckResponse,
  TimelineResponse,
  TodaySummary,
  TriageRequest,
  TriageResponse,
  UntriageResponse,
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
  getReminders(): Promise<RemindersResponse>
  getBriefs(): Promise<BriefsResponse>
  getBrief(id: string): Promise<BriefDetail>
  search(query: string): Promise<SearchResponse>

  capture(req: CaptureRequest): Promise<CaptureResponse>
  triage(itemId: string, req: TriageRequest): Promise<TriageResponse>
  flagMemory(itemId: string, req: FlagRequest): Promise<FlagResponse>
  followupAction(itemId: string, req: FollowupActionRequest): Promise<FollowupActionResponse>
  tickHabit(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse>
  ackSync(req: SyncAckRequest): Promise<SyncAckResponse>

  // Undo endpoints: each cancels a still-unprocessed pending action.
  // "gone" = the agent already handled it, nothing left to cancel.
  undoFollowupAction(itemId: string): Promise<FollowupActionResponse>
  undoHabitTick(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse>
  untriage(itemId: string): Promise<UntriageResponse>
}
