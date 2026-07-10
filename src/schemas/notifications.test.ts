import { describe, expect, it } from 'vitest'
import { NotificationCaptureRequest, NotificationCaptureResponse } from '@/schemas'

const valid = {
  clientId: '6fa459ea-ee8a-3ca4-894e-db77e160355e',
  package: 'com.whatsapp',
  postedAt: '2026-07-11T09:30:00+02:00',
  capturedAt: '2026-07-11T09:30:02+02:00',
  title: 'Maria',
  text: 'Are we still on for tomorrow?',
}

describe('notification capture schemas', () => {
  it('round-trips a request without bigText', () => {
    const parsed = NotificationCaptureRequest.parse(valid)
    expect(parsed).toEqual(valid)
    expect('bigText' in parsed).toBe(false)
  })

  it('round-trips a request with bigText', () => {
    const withBig = { ...valid, bigText: 'Are we still on for tomorrow? I could do 19:00.' }
    expect(NotificationCaptureRequest.parse(withBig)).toEqual(withBig)
  })

  it('rejects a clientId shorter than 8 characters', () => {
    expect(NotificationCaptureRequest.safeParse({ ...valid, clientId: 'short' }).success).toBe(
      false,
    )
  })

  it('rejects an empty or over-long package name', () => {
    expect(NotificationCaptureRequest.safeParse({ ...valid, package: '' }).success).toBe(false)
    expect(
      NotificationCaptureRequest.safeParse({ ...valid, package: 'a'.repeat(101) }).success,
    ).toBe(false)
  })

  it('enforces the title and text length caps', () => {
    expect(
      NotificationCaptureRequest.safeParse({ ...valid, title: 'a'.repeat(301) }).success,
    ).toBe(false)
    expect(
      NotificationCaptureRequest.safeParse({ ...valid, text: 'a'.repeat(4097) }).success,
    ).toBe(false)
    expect(
      NotificationCaptureRequest.safeParse({ ...valid, bigText: 'a'.repeat(4097) }).success,
    ).toBe(false)
  })

  it('parses both response statuses and rejects unknown ones', () => {
    expect(NotificationCaptureResponse.parse({ status: 'ok', itemId: 'n-1' })).toEqual({
      status: 'ok',
      itemId: 'n-1',
    })
    expect(NotificationCaptureResponse.parse({ status: 'duplicate', itemId: 'n-1' })).toEqual({
      status: 'duplicate',
      itemId: 'n-1',
    })
    expect(NotificationCaptureResponse.safeParse({ status: 'gone', itemId: 'n-1' }).success).toBe(
      false,
    )
  })
})
