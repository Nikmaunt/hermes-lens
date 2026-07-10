import { describe, expect, it } from 'vitest'
import type { AgentStatus, FollowUp, TodaySummary } from '@/schemas'
import {
  WIDGET_STALE_MS,
  composeWidgetSummary,
  isSummaryStale,
} from './composeSummary'

/*
 * Widget summary v2 — the JSON contract between the web app and
 * TodayWidgetProvider.java. The composer is pure: fixed `now`, no Capacitor.
 * Times are built with the local-time Date constructor so the suite passes
 * in any timezone (see hermes-lens test conventions).
 */

const NOW = new Date(2026, 6, 6, 14, 5) // Mon 6 Jul 2026, 14:05 local
const iso = (d: Date) => d.toISOString()
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let nextId = 0
function fu(over: Partial<FollowUp> = {}): FollowUp {
  nextId += 1
  return {
    id: `fu-${nextId}`,
    title: `Follow-up ${nextId}`,
    dueDate: null,
    source: 'telegram 1 Jul',
    urgency: 'soon',
    ...over,
  }
}

function summary(over: Partial<TodaySummary> = {}): TodaySummary {
  return {
    date: '2026-07-06',
    followUps: [],
    deadlines: [],
    agentActivity: [],
    inboxCount: 0,
    generatedAt: iso(NOW),
    ...over,
  }
}

function okStatus(over: Partial<AgentStatus> = {}): AgentStatus {
  return {
    gateway: { alive: true, lastHeartbeat: iso(NOW) },
    cronJobs: [
      { id: 'c1', name: 'backup', schedule: 'daily 03:00', lastRun: iso(NOW), lastResult: 'ok' },
      { id: 'c2', name: 'digest', schedule: 'daily 06:00', lastRun: iso(NOW), lastResult: 'ok' },
    ],
    lastBackup: { at: iso(hoursAgo(2)), sizeBytes: 1024, target: 'b2' },
    system: {
      diskUsedBytes: 0,
      diskTotalBytes: 1,
      ramUsedBytes: 0,
      ramTotalBytes: 1,
      uptimeSeconds: 0,
    },
    tokenSpend: { todayUsd: 0, monthUsd: 0 },
    generatedAt: iso(NOW),
    ...over,
  }
}

const compose = (
  s: TodaySummary,
  over: Partial<Parameters<typeof composeWidgetSummary>[1]> = {},
) => composeWidgetSummary(s, { status: okStatus(), now: NOW, ...over })

describe('top-3 selection', () => {
  it('takes the first three open follow-ups and counts them all', () => {
    const s = summary({ followUps: [fu(), fu(), fu(), fu(), fu()], inboxCount: 4 })
    const v2 = compose(s)
    expect(v2.v).toBe(2)
    expect(v2.followUps).toHaveLength(3)
    expect(v2.followUps.map((f) => f.title)).toEqual(s.followUps.slice(0, 3).map((f) => f.title))
    expect(v2.followUpCount).toBe(5)
    expect(v2.inbox).toBe(4)
  })

  it('excludes items with a server-side pendingAction from rows and counts', () => {
    const pending = fu({
      pendingAction: { action: 'done', requestedAt: iso(NOW) },
    })
    const open = fu()
    const v2 = compose(summary({ followUps: [pending, open] }))
    expect(v2.followUps.map((f) => f.title)).toEqual([open.title])
    expect(v2.followUpCount).toBe(1)
  })

  it('excludes items with local pending mutations (queued or just tapped)', () => {
    const tapped = fu()
    const open = fu()
    const v2 = compose(summary({ followUps: [tapped, open] }), {
      pendingIds: new Set([tapped.id]),
    })
    expect(v2.followUps.map((f) => f.title)).toEqual([open.title])
    expect(v2.followUpCount).toBe(1)
  })
})

describe('due formatting', () => {
  it('maps urgency to overdue / today / Nd', () => {
    const s = summary({
      followUps: [
        fu({ urgency: 'overdue', dueDate: '2026-07-04' }),
        fu({ urgency: 'today', dueDate: '2026-07-06' }),
        fu({ urgency: 'soon', dueDate: '2026-07-08' }),
      ],
    })
    expect(compose(s).followUps.map((f) => f.due)).toEqual(['overdue', 'today', '2d'])
  })

  it('falls back to "soon" when a soon item has no due date', () => {
    const v2 = compose(summary({ followUps: [fu({ urgency: 'soon', dueDate: null })] }))
    expect(v2.followUps[0]?.due).toBe('soon')
  })
})

describe('deadline line', () => {
  it('formats the nearest deadline as "Title — D Mon (Nd)"', () => {
    const s = summary({
      deadlines: [
        { id: 'd1', title: 'Visa', date: '2026-07-13', kind: 'document', daysLeft: 7 },
        { id: 'd2', title: 'Hosting', date: '2026-07-20', kind: 'subscription', daysLeft: 14 },
      ],
    })
    expect(compose(s).deadline).toBe('Visa — 13 Jul (7d)')
  })

  it('says (today) when the deadline is due now', () => {
    const s = summary({
      deadlines: [{ id: 'd1', title: 'Visa', date: '2026-07-06', kind: 'document', daysLeft: 0 }],
    })
    expect(compose(s).deadline).toBe('Visa — 6 Jul (today)')
  })

  it('is null when nothing is due in the next 30 days', () => {
    expect(compose(summary()).deadline).toBeNull()
  })
})

describe('brief line (additive v2 field)', () => {
  it("carries today's brief title when one exists", () => {
    const s = summary({ brief: { id: 'b1', title: 'Quiet day, two things need you' } })
    expect(compose(s).brief).toBe('Quiet day, two things need you')
  })

  it('is null when the payload has no brief', () => {
    expect(compose(summary()).brief).toBeNull()
  })
})

describe('health line', () => {
  it('reports "no data" when the status cache is empty', () => {
    expect(compose(summary(), { status: null }).health).toBe('no data')
  })

  it('reports the gateway being down', () => {
    const status = okStatus({ gateway: { alive: false, lastHeartbeat: iso(hoursAgo(5)) } })
    expect(compose(summary(), { status }).health).toBe('agent offline')
  })

  it('gateway down wins over a cron error', () => {
    const status = okStatus({
      gateway: { alive: false, lastHeartbeat: iso(hoursAgo(5)) },
      cronJobs: [
        { id: 'c1', name: 'digest', schedule: 'daily', lastRun: iso(NOW), lastResult: 'error' },
      ],
    })
    expect(compose(summary(), { status }).health).toBe('agent offline')
  })

  it('reports a cron error', () => {
    const status = okStatus({
      cronJobs: [
        { id: 'c1', name: 'backup', schedule: 'daily', lastRun: iso(NOW), lastResult: 'ok' },
        { id: 'c2', name: 'digest', schedule: 'daily', lastRun: iso(NOW), lastResult: 'error' },
      ],
    })
    expect(compose(summary(), { status }).health).toBe('cron: error')
  })

  it('reports a backup older than 48h with its age in days', () => {
    const status = okStatus({
      lastBackup: { at: iso(hoursAgo(72)), sizeBytes: 1, target: 'b2' },
    })
    expect(compose(summary(), { status }).health).toBe('backup 3d ago')
  })

  it('a backup at exactly 48h is not yet stale', () => {
    const status = okStatus({
      lastBackup: { at: iso(hoursAgo(48)), sizeBytes: 1, target: 'b2' },
    })
    expect(compose(summary(), { status }).health).toBe('ok · backup today')
  })

  it('reports a missing backup', () => {
    const status = okStatus({ lastBackup: null })
    expect(compose(summary(), { status }).health).toBe('no backup')
  })

  it('reports ok when everything is healthy', () => {
    expect(compose(summary()).health).toBe('ok · backup today')
  })
})

describe('locked mode (widgetHideDetails)', () => {
  it('drops titles, counts and the deadline but keeps health and the stamp', () => {
    const s = summary({
      followUps: [fu({ title: 'Secret task' })],
      deadlines: [{ id: 'd1', title: 'Visa', date: '2026-07-13', kind: 'document', daysLeft: 7 }],
      inboxCount: 9,
      brief: { id: 'b1', title: 'Secret brief' },
    })
    const v2 = compose(s, { masked: true })
    expect(v2.masked).toBe(true)
    expect(v2.followUps).toEqual([])
    expect(v2.followUpCount).toBe(0)
    expect(v2.inbox).toBe(0)
    expect(v2.deadline).toBeNull()
    expect(v2.brief).toBeNull()
    expect(v2.health).toBe('ok · backup today')
    expect(v2.updatedAt).toBe('14:05')
    expect(JSON.stringify(v2)).not.toContain('Secret task')
    expect(JSON.stringify(v2)).not.toContain('Visa')
    expect(JSON.stringify(v2)).not.toContain('Secret brief')
  })
})

describe('update stamp', () => {
  it('carries HH:MM and the epoch of the compose moment', () => {
    const v2 = compose(summary())
    expect(v2.updatedAt).toBe('14:05')
    expect(v2.updatedAtEpoch).toBe(NOW.getTime())
  })
})

describe('staleness threshold (mirrors TodayWidgetProvider.java)', () => {
  it('is exactly 24 hours', () => {
    expect(WIDGET_STALE_MS).toBe(24 * 3_600_000)
  })

  it('flags summaries older than 24h, not younger ones', () => {
    const epoch = NOW.getTime()
    expect(isSummaryStale(epoch, hoursAgo(-23).getTime())).toBe(false)
    expect(isSummaryStale(epoch, epoch + WIDGET_STALE_MS)).toBe(false)
    expect(isSummaryStale(epoch, epoch + WIDGET_STALE_MS + 1)).toBe(true)
  })
})
