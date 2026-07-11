import { useEffect, useRef } from 'react'
import { useData } from '@/data/DataSourceProvider'
import { useSnackbar } from './SnackbarProvider'

/**
 * One-shot snackbar the moment a drain parks NEW dead letters — the user
 * must learn that an action was permanently rejected without having to
 * visit Settings first. Subscribes to the queue's dead-letter events rather
 * than the hydrated count, so dead letters restored from storage on boot
 * (already announced in the session that parked them) stay silent.
 */
export function DeadLetterNotifier() {
  const { queue } = useData()
  const { show } = useSnackbar()
  const known = useRef<number | null>(null)

  useEffect(() => {
    void queue.deadLetters().then((dead) => {
      known.current ??= dead.length
    })
    return queue.onDeadLetterChange((count) => {
      const before = known.current
      known.current = count
      // before === null: an event outraced the baseline read — treat it as
      // the baseline rather than guessing how many are new.
      if (before === null || count <= before) return
      const fresh = count - before
      show({
        message: `${fresh} action${fresh === 1 ? '' : 's'} failed to sync — review in Settings`,
      })
    })
  }, [queue, show])

  return null
}
