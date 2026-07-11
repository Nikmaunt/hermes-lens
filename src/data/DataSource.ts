import type {
  AgentStatus,
  BriefDetail,
  BriefsResponse,
  CaptureRequest,
  CaptureResponse,
  ChatJobResponse,
  ChatStartRequest,
  ChatStartResponse,
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
  NotificationCaptureRequest,
  NotificationCaptureResponse,
  PeopleResponse,
  ProjectsResponse,
  RemindersResponse,
  SearchResponse,
  SomedayActionRequest,
  SomedayActionResponse,
  SomedayResponse,
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
  getInbox(): Promise<InboxResponse>
  getReminders(): Promise<RemindersResponse>
  getBriefs(): Promise<BriefsResponse>
  getBrief(id: string): Promise<BriefDetail>
  getSomeday(): Promise<SomedayResponse>
  search(query: string): Promise<SearchResponse>

  capture(req: CaptureRequest): Promise<CaptureResponse>
  triage(itemId: string, req: TriageRequest): Promise<TriageResponse>
  flagMemory(itemId: string, req: FlagRequest): Promise<FlagResponse>
  followupAction(itemId: string, req: FollowupActionRequest): Promise<FollowupActionResponse>
  // Covers activate/close AND undo — the someday contract folds all three
  // into one discriminated request on the same endpoint.
  somedayAction(itemId: string, req: SomedayActionRequest): Promise<SomedayActionResponse>
  tickHabit(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse>
  ackSync(req: SyncAckRequest): Promise<SyncAckResponse>
  // Notification listener (web layer): replay a device notification captured
  // by the native buffer. 'duplicate' is success — the server already has it,
  // deduped by the clientId that is stable across offline-queue and buffer
  // replays. Always arrives via the mutation queue, never called directly.
  captureNotification(req: NotificationCaptureRequest): Promise<NotificationCaptureResponse>

  // Undo endpoints: each cancels a still-unprocessed pending action.
  // "gone" = the agent already handled it, nothing left to cancel.
  undoFollowupAction(itemId: string): Promise<FollowupActionResponse>
  undoHabitTick(itemId: string, req: HabitTickRequest): Promise<HabitTickResponse>
  untriage(itemId: string): Promise<UntriageResponse>

  // Chat with the Hermes agent (Release A). Two-step: startChat accepts a turn
  // and returns a running jobId; getChatJob polls it to done/error. Deliberately
  // NOT routed through the mutation queue — a blind offline replay would start a
  // second turn and lose the reply, so the chat path calls startChat directly
  // (D-A9). A poll of an unknown/TTL-expired jobId rejects like the server's 404.
  startChat(req: ChatStartRequest): Promise<ChatStartResponse>
  getChatJob(jobId: string): Promise<ChatJobResponse>
}
