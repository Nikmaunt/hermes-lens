// The block below is a VERBATIM mirror of the sidecar's
// contract/schemas/commands.ts — do not reformat or "improve" it here;
// change it in lockstep with the sidecar or not at all.
import { z } from 'zod'

export const AdhocDigestPayload = z.object({
  topic: z.string().min(1).max(500),
})
export const CreatePersonNotePayload = z.object({
  target: z.literal('people'),
  person: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  text: z.string().min(1).max(4096),
})
export const CommandRequest = z.discriminatedUnion('type', [
  z.object({ clientId: z.string().min(8), type: z.literal('adhoc-digest'),
    payload: AdhocDigestPayload }),
  z.object({ clientId: z.string().min(8), type: z.literal('create-note'),
    payload: CreatePersonNotePayload }),
])
export const CommandAccepted = z.object({
  status: z.enum(['ok', 'duplicate']), commandId: z.string(),
})
export const CommandStatus = z.object({
  commandId: z.string(), type: z.enum(['adhoc-digest', 'create-note']),
  requestedAt: z.string(),
  state: z.enum(['pending', 'running', 'done', 'error']),
  summary: z.string().optional(),
  result: z.object({ kind: z.enum(['brief', 'note']), id: z.string() }).optional(),
})
export const CommandsResponse = z.object({
  items: z.array(CommandStatus), generatedAt: z.string(),
})
// End of the verbatim mirror. Inferred types below follow the local
// schema-file convention.

export type AdhocDigestPayload = z.infer<typeof AdhocDigestPayload>
export type CreatePersonNotePayload = z.infer<typeof CreatePersonNotePayload>
export type CommandRequest = z.infer<typeof CommandRequest>
export type CommandAccepted = z.infer<typeof CommandAccepted>
export type CommandStatus = z.infer<typeof CommandStatus>
export type CommandsResponse = z.infer<typeof CommandsResponse>
export type CommandType = CommandStatus['type']
export type CommandState = CommandStatus['state']
