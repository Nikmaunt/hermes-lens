import { describe, expect, it } from 'vitest'
import {
  FollowUpPendingAction,
  FollowupActionRequest,
  SomedayActionRequest,
  SomedayActionResponse,
  SomedayItem,
  SomedayResponse,
  TodaySummary,
} from '@/schemas'

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

describe('someday list schemas honor the sidecar contract', () => {
  it('parses a /api/someday response — items with and without a pending action', () => {
    // Shaped after the sidecar's someday overlay payload.
    const response = {
      items: [
        {
          id: 'sd-11',
          title: 'Look into a standing desk',
          source: 'telegram 14 Jun',
        },
        {
          id: 'sd-12',
          title: 'Renew the PADI certification',
          pendingAction: {
            action: 'activate',
            date: '2026-08-01',
            requestedAt: '2026-07-09T08:12:44+02:00',
          },
        },
        {
          id: 'sd-13',
          title: 'Old idea: telegram digest bot',
          pendingAction: { action: 'close', requestedAt: '2026-07-09T08:13:02+02:00' },
        },
      ],
      generatedAt: '2026-07-09T08:15:00+02:00',
    }
    const parsed = SomedayResponse.parse(response)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.items[0]?.pendingAction).toBeUndefined()
    expect(parsed.items[1]?.pendingAction?.action).toBe('activate')
    expect(parsed.items[2]?.pendingAction?.action).toBe('close')
  })

  it('rejects a someday item whose pending action is not activate/close', () => {
    expect(
      SomedayItem.safeParse({
        id: 'sd-11',
        title: 'x',
        pendingAction: { action: 'snooze', requestedAt: '2026-07-09T08:12:44+02:00' },
      }).success,
    ).toBe(false)
  })

  it('parses the three action request shapes — activate needs a date, close/undo do not', () => {
    const activate = { action: 'activate', date: '2026-08-01' }
    expect(SomedayActionRequest.parse(activate)).toEqual(activate)
    expect(SomedayActionRequest.parse({ action: 'close' })).toEqual({ action: 'close' })
    expect(SomedayActionRequest.parse({ action: 'undo' })).toEqual({ action: 'undo' })

    // activate without a date is not a valid request
    expect(SomedayActionRequest.safeParse({ action: 'activate' }).success).toBe(false)
    // unknown verbs stay rejected
    expect(SomedayActionRequest.safeParse({ action: 'delete' }).success).toBe(false)
  })

  it('parses the action response — ok or gone, echoing the item', () => {
    expect(SomedayActionResponse.parse({ status: 'ok', itemId: 'sd-12' })).toEqual({
      status: 'ok',
      itemId: 'sd-12',
    })
    expect(SomedayActionResponse.parse({ status: 'gone', itemId: 'sd-13' })).toEqual({
      status: 'gone',
      itemId: 'sd-13',
    })
    expect(SomedayActionResponse.safeParse({ status: 'queued', itemId: 'sd-1' }).success).toBe(
      false,
    )
  })
})
