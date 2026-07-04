import { registerPlugin, type PermissionState } from '@capacitor/core'

export interface DeviceCalendar {
  id: string
  name: string
  account: string
  /** True for the on-device Hermes calendar (never syncs to any cloud). */
  isLocal: boolean
}

/**
 * Bridge to CalendarBridgePlugin.java. Every method requires the runtime
 * calendar permission; callers must check/request it first.
 */
export interface CalendarBridgePlugin {
  checkPermissions(): Promise<{ calendar: PermissionState }>
  requestPermissions(): Promise<{ calendar: PermissionState }>
  listCalendars(): Promise<{ calendars: DeviceCalendar[] }>
  ensureLocalCalendar(): Promise<{ id: string }>
  queryEvents(options: { calendarId: string; eventIds: number[] }): Promise<{ existing: number[] }>
  createEvent(options: {
    calendarId: string
    title: string
    description: string
    startMs: number
    endMs: number
    reminderMinutes?: number
  }): Promise<{ eventId: number }>
  updateEvent(options: {
    eventId: number
    title: string
    description: string
    startMs: number
    endMs: number
    reminderMinutes?: number
  }): Promise<void>
  deleteEvent(options: { eventId: number }): Promise<void>
}

export const CalendarBridge = registerPlugin<CalendarBridgePlugin>('CalendarBridge')
