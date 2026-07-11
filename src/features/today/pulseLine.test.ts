import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@/schemas'
import { backupFragment, nextTriageFragment, syncedFragment } from './pulseLine'

/*
 * Pure formatting of the Today pulse-line fragments:
 * "Synced HH:MM · backup <today|Nd ago> · next triage HH:MM".
 */

const statusWith = (lastBackup: AgentStatus['lastBackup']): AgentStatus => ({
  gateway: { alive: true, lastHeartbeat: '2026-07-11T08:00:00+02:00' },
  cronJobs: [],
  lastBackup,
  system: {
    diskUsedBytes: 1,
    diskTotalBytes: 2,
    ramUsedBytes: 1,
    ramTotalBytes: 2,
    uptimeSeconds: 0,
  },
  tokenSpend: { todayUsd: 0, monthUsd: 0 },
  generatedAt: '2026-07-11T08:00:00+02:00',
})

const backupAt = (at: string) => statusWith({ at, sizeBytes: 1024, target: 'b2://hermes' })

const NOW = new Date(2026, 6, 11, 14, 45) // local Sat 11 Jul 2026, 14:45

describe('syncedFragment', () => {
  it('renders the fetch time as HH:MM', () => {
    expect(syncedFragment('2026-07-11T09:05:00+02:00')).toMatch(/^Synced \d{2}:\d{2}$/)
  })
})

describe('backupFragment', () => {
  it('is omitted entirely while no status was ever cached', () => {
    expect(backupFragment(null, NOW)).toBeNull()
  })

  it('same-day backup reads "backup today" without the warn accent', () => {
    expect(backupFragment(backupAt('2026-07-11T03:10:00+02:00'), NOW)).toEqual({
      label: 'backup today',
      warn: false,
    })
  })

  it('yesterday reads "backup 1d ago", still calm', () => {
    expect(backupFragment(backupAt('2026-07-10T23:50:00+02:00'), NOW)).toEqual({
      label: 'backup 1d ago',
      warn: false,
    })
  })

  it('older than a day degrades to the warn accent', () => {
    expect(backupFragment(backupAt('2026-07-08T03:10:00+02:00'), NOW)).toEqual({
      label: 'backup 3d ago',
      warn: true,
    })
  })

  it('a status with no backup at all warns loudest', () => {
    expect(backupFragment(statusWith(null), NOW)).toEqual({
      label: 'backup never',
      warn: true,
    })
  })
})

describe('nextTriageFragment', () => {
  it('names the next cron run after now (14:45 → 15:30)', () => {
    expect(nextTriageFragment(NOW)).toBe('next triage 15:30')
  })

  it('rolls over past the last run of the day (22:00 → 03:30)', () => {
    expect(nextTriageFragment(new Date(2026, 6, 11, 22, 0))).toBe('next triage 03:30')
  })
})
