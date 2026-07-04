import { z } from 'zod'
import { Id, IsoDateTime } from './common'

export const CaptureRequest = z.object({
  text: z.string().min(1),
  tags: z.array(z.string()),
})
export type CaptureRequest = z.infer<typeof CaptureRequest>

export const CaptureResponse = z.object({
  status: z.literal('ok'),
  id: Id,
  capturedAt: IsoDateTime,
})
export type CaptureResponse = z.infer<typeof CaptureResponse>
