import { useRef, useState, type ReactNode, type TouchEvent } from 'react'

const TRIGGER_PX = 70
const MAX_PULL = 110

/**
 * Touch-driven pull-to-refresh. Active only when the page is scrolled to the
 * top; resistance curve keeps the gesture calm.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>
  children: ReactNode
}) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)

  const onTouchStart = (e: TouchEvent) => {
    if (window.scrollY <= 0 && !refreshing) startY.current = e.touches[0]?.clientY ?? null
  }

  const onTouchMove = (e: TouchEvent) => {
    if (startY.current === null || refreshing) return
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current
    if (dy <= 0 || window.scrollY > 0) {
      setPull(0)
      return
    }
    setPull(Math.min(MAX_PULL, dy * 0.45))
  }

  const onTouchEnd = () => {
    if (startY.current === null) return
    startY.current = null
    if (pull >= TRIGGER_PX && !refreshing) {
      setRefreshing(true)
      setPull(48)
      void onRefresh().finally(() => {
        setRefreshing(false)
        setPull(0)
      })
    } else {
      setPull(0)
    }
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div
        className="flex items-end justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: pull }}
      >
        <span
          className={`mb-3 text-lg text-faint ${refreshing ? 'animate-spin' : ''}`}
          style={{ transform: refreshing ? undefined : `rotate(${pull * 2.4}deg)` }}
        >
          ↻
        </span>
      </div>
      {children}
    </div>
  )
}
