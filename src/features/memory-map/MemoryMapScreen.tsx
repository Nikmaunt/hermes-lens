import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, ListSkeleton, StaleBanner } from '@/components/primitives'
import { GraphIcon } from '@/components/icons'
import { useMemoryItems } from '@/hooks/queries'
import {
  buildGraph,
  displayLabel,
  graphBounds,
  LABEL_FONTS,
  PHYSICS,
  placeLabels,
  settleGraph,
  stepSimulation,
  type GraphNode,
} from './graph'

/*
 * Living force-directed map (Obsidian-style): physics + inertia handled in
 * a single requestAnimationFrame loop that writes straight to the DOM —
 * React only re-renders on data/focus/label changes, never per frame.
 * The loop stops itself at equilibrium, pauses while the app is hidden and
 * is cancelled on unmount: nothing runs in the background, ever.
 */

const SCALE_MIN = 0.35
const SCALE_MAX = 3
/** Rest zoom: fit the graph but never below this — labels must stay legible. */
const FIT_SCALE_MIN = 0.8
const TAP_SLOP_PX = 8
const DOUBLE_TAP_MS = 300
const INERTIA_DECAY = 0.92

interface View {
  x: number
  y: number
  scale: number
}

interface AnimState {
  raf: number
  running: boolean
  alpha: number
  /** Previous rAF timestamp — the sim steps by wall-clock, not by frame. */
  lastT: number | null
  inertia: { vx: number; vy: number } | null
  viewAnim: { from: View; to: View; t: number } | null
}

export function MemoryMapScreen() {
  const { data, staleSince, errorKind, isLoading, error, refetch } = useMemoryItems()
  const navigate = useNavigate()
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Refetches churn `data`'s object identity without changing what the map
  // shows (e.g. re-materialized mock dates, touched updatedAt fields). Key
  // the graph by the content it actually renders, otherwise every refetch
  // restarts the entrance animation and the sim never settles.
  const items = data?.items
  const graphKey = useMemo(
    () => (items ?? []).map((i) => `${i.id}\t${i.category}\t${i.topic}\t${i.sensitivity}`).join('\n'),
    [items],
  )
  const graph = useMemo(() => {
    const g = buildGraph(items ?? [])
    // Reduced motion: no entrance animation, present the equilibrium as-is.
    if (reducedMotion) settleGraph(g)
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content, not identity
  }, [graphKey, reducedMotion])

  // Label placement targets the equilibrium, which is deterministic — so
  // compute it upfront on a settled clone and labels are readable even
  // while the entrance bloom is still moving. After user drags reshape the
  // layout, the settle handler below re-places them for the new positions.
  const initialLabels = useMemo(() => {
    if (reducedMotion || graph.nodes.length === 0) return placeLabels(graph.nodes)
    const preview = { nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links }
    settleGraph(preview)
    return placeLabels(preview.nodes)
  }, [graph, reducedMotion])
  const [settledLabels, setSettledLabels] = useState<{
    graph: unknown
    ids: Set<string>
  } | null>(null)
  const labelIds = settledLabels !== null && settledLabels.graph === graph ? settledLabels.ids : initialLabels
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const worldRef = useRef<SVGGElement | null>(null)
  const nodeElems = useRef(new Map<string, SVGGElement>())
  const edgeElems = useRef(new Map<number, SVGLineElement>())
  const view = useRef<View>({ x: 0, y: 0, scale: 1 })
  const anim = useRef<AnimState>({
    raf: 0,
    running: false,
    alpha: 0,
    lastT: null,
    inertia: null,
    viewAnim: null,
  })
  const dragNode = useRef<GraphNode | null>(null)

  // Pointer-gesture bookkeeping (pan / pinch / tap / node drag).
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const press = useRef<{ x: number; y: number; nodeId: string | null; moved: boolean } | null>(null)
  const pinch = useRef<{ span: number; scale: number } | null>(null)
  const panSamples = useRef<{ t: number; x: number; y: number }[]>([])
  const lastBackgroundTap = useRef<{ t: number; x: number; y: number } | null>(null)
  /** A drag/pan just ended — swallow the click it still produces. */
  const suppressTap = useRef(false)

  const applyView = () => {
    const { x, y, scale } = view.current
    worldRef.current?.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`)
  }

  const applyPositions = () => {
    for (const node of graph.nodes) {
      nodeElems.current.get(node.id)?.setAttribute('transform', `translate(${node.x} ${node.y})`)
    }
    graph.links.forEach((link, i) => {
      const el = edgeElems.current.get(i)
      if (el === undefined) return
      const a = graph.nodes[link.from]
      const b = graph.nodes[link.to]
      if (a === undefined || b === undefined) return
      el.setAttribute('x1', String(a.x))
      el.setAttribute('y1', String(a.y))
      el.setAttribute('x2', String(b.x))
      el.setAttribute('y2', String(b.y))
    })
  }

  /** Fit-and-center view (double-tap target and the initial rest zoom). */
  const restView = (): View => {
    const svg = svgRef.current
    if (svg === null) return { x: 0, y: 0, scale: 1 }
    const rect = svg.getBoundingClientRect()
    const b = graphBounds(graph.nodes)
    const w = Math.max(1, b.maxX - b.minX + 60)
    const h = Math.max(1, b.maxY - b.minY + 60)
    const scale = Math.min(1, Math.max(FIT_SCALE_MIN, Math.min(rect.width / w, rect.height / h)))
    return {
      x: rect.width / 2 - ((b.minX + b.maxX) / 2) * scale,
      y: rect.height / 2 - ((b.minY + b.maxY) / 2) * scale,
      scale,
    }
  }

  const startRef = useRef<() => void>(() => {})
  const ensureRunning = () => {
    if (!reducedMotion) startRef.current()
  }

  // The animation loop lives in one effect per graph. Restarting on graph
  // change also replays the entrance bloom for fresh data.
  useEffect(() => {
    const state = anim.current
    view.current = restView()
    applyView()
    applyPositions()

    if (reducedMotion || graph.nodes.length === 0) return

    state.alpha = 0.9
    const tick = (t: number) => {
      let more = false
      // Wall-clock stepping: a 30 fps WebView (or a throttled tab) runs
      // more sim steps per frame so the bloom stays a ~2 s experience.
      const steps = Math.min(4, Math.max(1, Math.round((t - (state.lastT ?? t)) / 16.7)))
      state.lastT = t

      if (state.alpha > PHYSICS.ALPHA_MIN || dragNode.current !== null) {
        for (let s = 0; s < steps; s++) {
          stepSimulation(graph, Math.max(state.alpha, PHYSICS.ALPHA_MIN))
          // Dragging keeps the sim warm so neighbours react under the finger.
          state.alpha =
            dragNode.current !== null ? Math.max(state.alpha, 0.3) : state.alpha * PHYSICS.ALPHA_DECAY
        }
        applyPositions()
        if (state.alpha > PHYSICS.ALPHA_MIN || dragNode.current !== null) more = true
        else {
          for (const node of graph.nodes) {
            node.vx = 0
            node.vy = 0
          }
          setSettledLabels({ graph, ids: placeLabels(graph.nodes) })
        }
      }

      const inertia = state.inertia
      if (inertia !== null) {
        for (let s = 0; s < steps && state.inertia !== null; s++) {
          view.current.x += inertia.vx
          view.current.y += inertia.vy
          inertia.vx *= INERTIA_DECAY
          inertia.vy *= INERTIA_DECAY
          if (Math.abs(inertia.vx) + Math.abs(inertia.vy) < 0.4) state.inertia = null
        }
        if (state.inertia !== null) more = true
        applyView()
      }

      const viewAnim = state.viewAnim
      if (viewAnim !== null) {
        viewAnim.t = Math.min(1, viewAnim.t + steps / 18)
        const e = 1 - (1 - viewAnim.t) ** 3
        view.current = {
          x: viewAnim.from.x + (viewAnim.to.x - viewAnim.from.x) * e,
          y: viewAnim.from.y + (viewAnim.to.y - viewAnim.from.y) * e,
          scale: viewAnim.from.scale + (viewAnim.to.scale - viewAnim.from.scale) * e,
        }
        applyView()
        if (viewAnim.t < 1) more = true
        else state.viewAnim = null
      }

      if (more) state.raf = requestAnimationFrame(tick)
      else state.running = false
    }

    const start = () => {
      if (state.running) return
      state.running = true
      state.lastT = null
      state.raf = requestAnimationFrame(tick)
    }
    startRef.current = start
    start()

    // No-background rule: the sim pauses the moment the app is hidden.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(state.raf)
        state.running = false
      } else if (state.alpha > PHYSICS.ALPHA_MIN || state.inertia !== null || state.viewAnim !== null) {
        start()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      cancelAnimationFrame(state.raf)
      state.running = false
      state.inertia = null
      state.viewAnim = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, reducedMotion])

  const toWorld = (sx: number, sy: number) => ({
    x: (sx - view.current.x) / view.current.scale,
    y: (sy - view.current.y) / view.current.scale,
  })

  const svgPoint = (e: ReactPointerEvent<SVGSVGElement> | ReactWheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  const zoomAt = (anchor: { x: number; y: number }, nextScale: number) => {
    const v = view.current
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, nextScale))
    view.current = {
      x: anchor.x - ((anchor.x - v.x) / v.scale) * scale,
      y: anchor.y - ((anchor.y - v.y) / v.scale) * scale,
      scale,
    }
    applyView()
  }

  const openNode = (node: GraphNode) => {
    if (node.kind === 'center') return
    const params = new URLSearchParams(node.category !== null ? { category: node.category } : {})
    if (node.topic !== undefined) params.set('topic', node.topic)
    void navigate(`/memory?${params.toString()}`)
  }

  const recenter = () => {
    const target = restView()
    if (reducedMotion) {
      view.current = target
      applyView()
      return
    }
    anim.current.inertia = null
    anim.current.viewAnim = { from: { ...view.current }, to: target, t: 0 }
    ensureRunning()
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Untrusted/synthetic pointers (tests, some a11y tools) can't be
      // captured — the gesture still works without capture.
    }
    const p = svgPoint(e)
    pointers.current.set(e.pointerId, p)
    anim.current.inertia = null
    anim.current.viewAnim = null

    if (pointers.current.size === 2) {
      // Second finger: whatever was happening becomes a pinch.
      releaseDraggedNode()
      press.current = null
      const pts = [...pointers.current.values()]
      pinch.current = {
        span: Math.max(1, Math.hypot((pts[0]?.x ?? 0) - (pts[1]?.x ?? 0), (pts[0]?.y ?? 0) - (pts[1]?.y ?? 0))),
        scale: view.current.scale,
      }
      return
    }

    const nodeId =
      e.target instanceof Element ? e.target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null : null
    press.current = { x: p.x, y: p.y, nodeId, moved: false }
    panSamples.current = [{ t: e.timeStamp, x: p.x, y: p.y }]
    suppressTap.current = false
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = svgPoint(e)
    const prev = pointers.current.get(e.pointerId) ?? p
    pointers.current.set(e.pointerId, p)

    if (pinch.current !== null && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      const span = Math.max(1, Math.hypot((pts[0]?.x ?? 0) - (pts[1]?.x ?? 0), (pts[0]?.y ?? 0) - (pts[1]?.y ?? 0)))
      const centroid = {
        x: ((pts[0]?.x ?? 0) + (pts[1]?.x ?? 0)) / 2,
        y: ((pts[0]?.y ?? 0) + (pts[1]?.y ?? 0)) / 2,
      }
      zoomAt(centroid, pinch.current.scale * (span / pinch.current.span))
      return
    }

    const pr = press.current
    if (pr === null) return
    if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) > TAP_SLOP_PX) pr.moved = true
    if (!pr.moved) return

    if (pr.nodeId !== null && !reducedMotion) {
      // Node drag: pin it under the finger, physics moves the neighbours.
      const node = graph.nodes.find((n) => n.id === pr.nodeId)
      if (node !== undefined && node.kind !== 'center') {
        const w = toWorld(p.x, p.y)
        node.fx = w.x
        node.fy = w.y
        dragNode.current = node
        ensureRunning()
        return
      }
    }

    // Pan.
    view.current.x += p.x - prev.x
    view.current.y += p.y - prev.y
    applyView()
    panSamples.current.push({ t: e.timeStamp, x: p.x, y: p.y })
    if (panSamples.current.length > 5) panSamples.current.shift()
  }

  const releaseDraggedNode = () => {
    const node = dragNode.current
    if (node === null) return
    node.fx = null
    node.fy = null
    dragNode.current = null
    // Spring-back: leave some heat so the node glides home.
    anim.current.alpha = Math.max(anim.current.alpha, 0.3)
    ensureRunning()
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = svgPoint(e)
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null

    const pr = press.current
    press.current = null

    if (dragNode.current !== null) {
      suppressTap.current = true
      releaseDraggedNode()
      return
    }
    if (pr === null) return

    suppressTap.current = pr.moved
    if (!pr.moved) {
      // Node taps ride the native click event (fires right after pointerup,
      // works for assistive tech too); background taps may be a double-tap.
      if (pr.nodeId !== null) return
      const last = lastBackgroundTap.current
      if (
        last !== null &&
        e.timeStamp - last.t < DOUBLE_TAP_MS &&
        Math.hypot(p.x - last.x, p.y - last.y) < 40
      ) {
        lastBackgroundTap.current = null
        recenter()
      } else {
        lastBackgroundTap.current = { t: e.timeStamp, x: p.x, y: p.y }
      }
      return
    }

    // Fling: keep panning with the gesture's velocity.
    if (!reducedMotion && panSamples.current.length >= 2) {
      const a = panSamples.current[0]
      const b = panSamples.current[panSamples.current.length - 1]
      if (a !== undefined && b !== undefined && b.t > a.t) {
        const dt = b.t - a.t
        const vx = ((b.x - a.x) / dt) * 16
        const vy = ((b.y - a.y) / dt) * 16
        if (Math.abs(vx) + Math.abs(vy) > 2) {
          anim.current.inertia = { vx, vy }
          ensureRunning()
        }
      }
    }
  }

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    zoomAt(svgPoint(e), view.current.scale * (e.deltaY < 0 ? 1.15 : 0.87))
  }

  const nodeAria = (node: GraphNode): string => {
    const facts = `${node.count} ${node.count === 1 ? 'fact' : 'facts'}`
    if (node.sensitive) return `Sensitive topic, ${facts} — name hidden`
    if (node.kind === 'hub') return `Category: ${node.label}, ${facts}`
    return `Topic: ${node.label}, ${facts}`
  }

  return (
    <Screen title="Memory Map" back>
      <StaleBanner since={staleSince} />
      {isLoading && <ListSkeleton rows={4} />}
      {!isLoading && error !== null && data === undefined && (
        <ErrorState kind={errorKind} onRetry={() => void refetch()} />
      )}
      {data !== undefined && graph.nodes.length === 0 && (
        <EmptyState icon={<GraphIcon size={30} />} title="Memory is empty" />
      )}
      {graph.nodes.length > 0 && (
        <>
          <div className="mb-2 px-1 text-caption text-faint">
            drag nodes · fling to pan · pinch to zoom · double-tap to re-center · tap a node to open
          </div>
          <div className="border-line bg-surface overflow-hidden rounded-(--radius-card) border">
            <svg
              ref={svgRef}
              role="group"
              aria-label="Memory map"
              className="h-[70vh] w-full touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            >
              <defs>
                <filter id="hl-node-glow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="7" />
                </filter>
              </defs>
              <g ref={worldRef}>
                {graph.links.map((link, i) => (
                  <line
                    key={i}
                    ref={(el) => {
                      if (el !== null) edgeElems.current.set(i, el)
                      else edgeElems.current.delete(i)
                    }}
                    x1={graph.nodes[link.from]?.x}
                    y1={graph.nodes[link.from]?.y}
                    x2={graph.nodes[link.to]?.x}
                    y2={graph.nodes[link.to]?.y}
                    stroke="var(--hl-line)"
                    strokeWidth={link.from === 0 ? 1 : 0.75}
                  />
                ))}
                {graph.nodes.map((node) => {
                  const focused = focusedId === node.id
                  const showLabel = focused || labelIds.has(node.id)
                  const accent = node.sensitive ? 'var(--hl-danger)' : 'var(--hl-accent)'
                  return (
                    <g
                      key={node.id}
                      data-node-id={node.id}
                      ref={(el) => {
                        if (el !== null) nodeElems.current.set(node.id, el)
                        else nodeElems.current.delete(node.id)
                      }}
                      transform={`translate(${node.x} ${node.y})`}
                      role={node.kind === 'center' ? undefined : 'button'}
                      tabIndex={node.kind === 'center' ? undefined : 0}
                      aria-label={node.kind === 'center' ? undefined : nodeAria(node)}
                      onClick={() => {
                        if (!suppressTap.current) openNode(node)
                      }}
                      onFocus={() => setFocusedId(node.id)}
                      onBlur={() => setFocusedId((id) => (id === node.id ? null : id))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openNode(node)
                        }
                      }}
                      className={node.kind === 'center' ? undefined : 'cursor-pointer focus-visible:outline-none'}
                    >
                      {/* Generous invisible hit area (≥44px even for small dots). */}
                      <circle r={Math.max(node.r + 4, 24)} fill="transparent" />
                      {focused && (
                        <circle r={node.r + 8} fill={accent} opacity={0.4} filter="url(#hl-node-glow)" />
                      )}
                      {node.kind === 'center' ? (
                        <>
                          <circle r={node.r} fill="var(--hl-accent-dim)" />
                          <text
                            y={4}
                            textAnchor="middle"
                            fill="var(--hl-accent)"
                            fontSize={13}
                            fontWeight={700}
                          >
                            me
                          </text>
                        </>
                      ) : (
                        <>
                          <circle
                            r={node.r}
                            fill={node.kind === 'hub' ? 'var(--hl-raised)' : 'var(--hl-surface)'}
                            stroke={accent}
                            strokeOpacity={focused ? 1 : node.kind === 'hub' ? 0.9 : 0.5}
                            strokeWidth={node.kind === 'hub' ? 1.5 : 1}
                          />
                          {node.kind === 'hub' && (
                            <text
                              y={4}
                              textAnchor="middle"
                              fill="var(--hl-muted)"
                              fontSize={11}
                              className="tnum"
                            >
                              {node.count}
                            </text>
                          )}
                          <text
                            y={node.r + 4 + LABEL_FONTS[node.kind]}
                            textAnchor="middle"
                            fill={node.kind === 'hub' ? 'var(--hl-ink)' : 'var(--hl-muted)'}
                            fontSize={LABEL_FONTS[node.kind]}
                            fontWeight={node.kind === 'hub' ? 700 : 500}
                            opacity={showLabel ? 1 : 0}
                            style={{ transition: 'opacity 0.25s ease' }}
                          >
                            {displayLabel(node, focused)}
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </>
      )}
    </Screen>
  )
}
