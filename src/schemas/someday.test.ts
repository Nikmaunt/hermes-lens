import { describe, expect, it } from 'vitest'
import { FollowUpPendingAction, FollowupActionRequest, TodaySummary } from '@/schemas'

/*
 * Contract tests for the "someday" follow-up action.
 *
 * Like chat, this is sidecar-first: the deployed sidecar starts serving
 * pendingAction "someday" in the /api/today overlay (and accepting it on the
 * follow-up action endpoint) before any Someday screen ships in the app. The
 * live prod contract is the source of truth; these fixtures mirror what the
 * server actually sends. The old ['done','snooze'] enums would reject such a
 * response wholesale — these tests pin the required tolerance.
 */
describe('someday tolerance in the today/followups contract', () => {
  it('accepts a /api/today response whose follow-up has a pending "someday" action', () => {
    // Shaped after a real /api/today overlay payload, trimmed to one follow-up.
    const today = {
      date: '2026-07-09',
      followUps: [
        {
          id: 'fu-3021',
          title: 'Reply to the notary about the apartment deed',
          dueDate: null,
          source: 'telegram 02 Jul',
          urgency: 'soon',
          pendingAction: { action: 'someday', requestedAt: '2026-07-09T08:12:44+02:00' },
        },
      ],
      deadlines: [],
      agentActivity: [],
      inboxCount: 2,
      generatedAt: '2026-07-09T08:15:00+02:00',
    }
    const parsed = TodaySummary.parse(today)
    expect(parsed.followUps[0]?.pendingAction?.action).toBe('someday')
  })

  it('accepts "someday" as a queued pending action', () => {
    const pending = { action: 'someday', requestedAt: '2026-07-09T08:12:44+02:00' }
    expect(FollowUpPendingAction.parse(pending)).toEqual(pending)
  })

  it('accepts "someday" in the follow-up action request', () => {
    const request = { action: 'someday' }
    expect(FollowupActionRequest.parse(request)).toEqual(request)
  })

  it('still rejects unknown actions in both directions', () => {
    expect(FollowupActionRequest.safeParse({ action: 'later' }).success).toBe(false)
    expect(
      FollowUpPendingAction.safeParse({
        action: 'later',
        requestedAt: '2026-07-09T08:12:44+02:00',
      }).success,
    ).toBe(false)
  })
})
