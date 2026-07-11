import { describe, expect, it } from 'vitest'
import { CommandAccepted, CommandRequest, CommandsResponse, CommandStatus } from '@/schemas'

/*
 * Round-trip tests for the command contract. The schema block in
 * src/schemas/commands.ts is a verbatim mirror of the sidecar's
 * contract/schemas/commands.ts — these tests pin the shape on the client
 * side so a drifted copy fails loudly.
 */
describe('command schemas (sidecar contract mirror)', () => {
  it('round-trips an adhoc-digest request', () => {
    const req = {
      clientId: 'client-adhoc-1',
      type: 'adhoc-digest',
      payload: { topic: 'Portland flat market this week' },
    }
    expect(CommandRequest.parse(req)).toEqual(req)
  })

  it('round-trips a create-note request, with and without the optional title', () => {
    const full = {
      clientId: 'client-note-1',
      type: 'create-note',
      payload: { target: 'people', person: 'Maria', title: 'Agreement', text: 'Owes me a book.' },
    }
    expect(CommandRequest.parse(full)).toEqual(full)

    const minimal = {
      clientId: 'client-note-2',
      type: 'create-note',
      payload: { target: 'people', person: 'Maria', text: 'Owes me a book.' },
    }
    expect(CommandRequest.parse(minimal)).toEqual(minimal)
  })

  it('rejects unknown types, short clientIds and payload/type mismatches', () => {
    expect(
      CommandRequest.safeParse({
        clientId: 'client-x-1',
        type: 'reboot-vps',
        payload: { topic: 'nope' },
      }).success,
    ).toBe(false)
    expect(
      CommandRequest.safeParse({
        clientId: 'short',
        type: 'adhoc-digest',
        payload: { topic: 'ok' },
      }).success,
    ).toBe(false)
    expect(
      CommandRequest.safeParse({
        clientId: 'client-x-2',
        type: 'adhoc-digest',
        payload: { person: 'Maria', text: 'wrong payload for the type', target: 'people' },
      }).success,
    ).toBe(false)
  })

  it('enforces the sidecar field caps (topic ≤ 500, person ≤ 120, text ≤ 4096)', () => {
    expect(
      CommandRequest.safeParse({
        clientId: 'client-cap-1',
        type: 'adhoc-digest',
        payload: { topic: 'x'.repeat(501) },
      }).success,
    ).toBe(false)
    expect(
      CommandRequest.safeParse({
        clientId: 'client-cap-2',
        type: 'create-note',
        payload: { target: 'people', person: 'p'.repeat(121), text: 'hi' },
      }).success,
    ).toBe(false)
    expect(
      CommandRequest.safeParse({
        clientId: 'client-cap-3',
        type: 'create-note',
        payload: { target: 'people', person: 'Maria', text: 't'.repeat(4097) },
      }).success,
    ).toBe(false)
  })

  it('parses the accepted response for both ok and duplicate', () => {
    expect(CommandAccepted.parse({ status: 'ok', commandId: 'cmd-1' })).toEqual({
      status: 'ok',
      commandId: 'cmd-1',
    })
    expect(CommandAccepted.parse({ status: 'duplicate', commandId: 'cmd-1' })).toEqual({
      status: 'duplicate',
      commandId: 'cmd-1',
    })
    expect(CommandAccepted.safeParse({ status: 'created', commandId: 'cmd-1' }).success).toBe(false)
  })

  it('parses a commands list across all four states', () => {
    const response = {
      generatedAt: '2026-07-12T10:00:00+02:00',
      items: [
        {
          commandId: 'cmd-1',
          type: 'adhoc-digest',
          requestedAt: '2026-07-12T09:00:00+02:00',
          state: 'pending',
        },
        {
          commandId: 'cmd-2',
          type: 'create-note',
          requestedAt: '2026-07-12T09:05:00+02:00',
          state: 'running',
        },
        {
          commandId: 'cmd-3',
          type: 'adhoc-digest',
          requestedAt: '2026-07-12T09:10:00+02:00',
          state: 'done',
          summary: 'Digest brief generated',
          result: { kind: 'brief', id: 'brief-42' },
        },
        {
          commandId: 'cmd-4',
          type: 'create-note',
          requestedAt: '2026-07-12T09:15:00+02:00',
          state: 'error',
          summary: 'Person file could not be written',
        },
      ],
    }
    const parsed = CommandsResponse.parse(response)
    expect(parsed).toEqual(response)
    for (const item of parsed.items) expect(CommandStatus.parse(item)).toEqual(item)
    expect(
      CommandStatus.safeParse({
        commandId: 'cmd-5',
        type: 'adhoc-digest',
        requestedAt: '2026-07-12T09:20:00+02:00',
        state: 'cancelled',
      }).success,
    ).toBe(false)
  })
})
