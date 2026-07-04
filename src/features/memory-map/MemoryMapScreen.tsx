import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { useNavigate } from 'react-router'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, ListSkeleton, StaleBanner } from '@/components/primitives'
import { useMemoryItems } from '@/hooks/queries'
import type { MemoryCategory, MemoryItem } from '@/schemas'

/*
 * Deterministic radial layout, no physics: category hubs sit on an inner
 * ring around the center, topics fan out around their hub. A few hundred
 * nodes render as plain SVG circles — cheap to lay out and to hit-test.
 */

const VIEW = 720
const CENTER = VIEW / 2
const HUB_RING = 200
const TOPIC_RING = 92

interface Node {
  id: string
  label: string
  count: number
  x: number
  y: number
  r: number
  kind: 'hub' | 'topic'
  category: MemoryCategory
  topic?: string
  sensitive: boolean
}

function buildNodes(items: MemoryItem[]): Node[] {
  const byCategory = new Map<MemoryCategory, MemoryItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.category)
    if (list === undefined) byCategory.set(item.category, [item])
    else list.push(item)
  }

  const nodes: Node[] = []
  const categories = [...byCategory.entries()]
  categories.forEach(([category, catItems], i) => {
    const angle = (i / categories.length) * Math.PI * 2 - Math.PI / 2
    const hx = CENTER + Math.cos(angle) * HUB_RING
    const hy = CENTER + Math.sin(angle) * HUB_RING
    nodes.push({
      id: `hub-${category}`,
      label: category,
      count: catItems.length,
      x: hx,
      y: hy,
      r: 20 + Math.min(16, catItems.length * 1.6),
      kind: 'hub',
      category,
      sensitive: false,
    })

    const byTopic = new Map<string, MemoryItem[]>()
    for (const item of catItems) {
      const list = byTopic.get(item.topic)
      if (list === undefined) byTopic.set(item.topic, [item])
      else list.push(item)
    }
    const topics = [...byTopic.entries()]
    topics.forEach(([topic, topicItems], j) => {
      // Fan topics on the outward-facing arc of their hub.
      const spread = Math.PI * 0.9
      const start = angle - spread / 2
      const theta = topics.length === 1 ? angle : start + (j / (topics.length - 1)) * spread
      nodes.push({
        id: `topic-${category}-${topic}`,
        label: topic,
        count: topicItems.length,
        x: hx + Math.cos(theta) * TOPIC_RING,
        y: hy + Math.sin(theta) * TOPIC_RING,
        r: 9 + Math.min(9, topicItems.length * 2.2),
        kind: 'topic',
        category,
        topic,
        sensitive: topicItems.some((t) => t.sensitivity === 'sensitive'),
      })
    })
  })
  return nodes
}

export function MemoryMapScreen() {
  const { data, staleSince, isLoading, error, refetch } = useMemoryItems()
  const navigate = useNavigate()

  const nodes = useMemo(() => buildNodes(data?.items ?? []), [data])

  // viewBox pan/zoom driven by pointer events.
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: typeof view; centroid: { x: number; y: number }; span: number } | null>(null)
  const moved = useRef(false)

  const centroidAndSpan = () => {
    const pts = [...pointers.current.values()]
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const span =
      pts.length < 2
        ? 1
        : Math.hypot((pts[0]?.x ?? 0) - (pts[1]?.x ?? 0), (pts[0]?.y ?? 0) - (pts[1]?.y ?? 0))
    return { centroid: { x: cx, y: cy }, span: Math.max(1, span) }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    gesture.current = { view, ...centroidAndSpan() }
    if (pointers.current.size === 1) moved.current = false
  }

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId) || gesture.current === null) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const { centroid, span } = centroidAndSpan()
    const start = gesture.current
    const dx = centroid.x - start.centroid.x
    const dy = centroid.y - start.centroid.y
    if (Math.abs(dx) + Math.abs(dy) > 6) moved.current = true
    const scale = Math.min(3, Math.max(0.5, start.view.scale * (span / start.span)))
    setView({ x: start.view.x + dx, y: start.view.y + dy, scale })
  }

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    gesture.current = pointers.current.size > 0 ? { view, ...centroidAndSpan() } : null
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    setView((v) => ({ ...v, scale: Math.min(3, Math.max(0.5, v.scale * (e.deltaY < 0 ? 1.15 : 0.87))) }))
  }

  const openNode = (node: Node) => {
    if (moved.current) return // it was a pan, not a tap
    const params = new URLSearchParams({ category: node.category })
    if (node.topic !== undefined) params.set('topic', node.topic)
    void navigate(`/memory?${params.toString()}`)
  }

  return (
    <Screen title="Memory Map" back>
      <StaleBanner since={staleSince} />
      {isLoading && <ListSkeleton rows={4} />}
      {!isLoading && error !== null && data === undefined && (
        <ErrorState
          message="Agent unreachable and no cached data yet"
          onRetry={() => void refetch()}
        />
      )}
      {data !== undefined && nodes.length === 0 && (
        <EmptyState icon="🕸" title="Memory is empty" />
      )}
      {nodes.length > 0 && (
        <>
          <div className="mb-2 px-1 text-[11px] text-faint">
            drag to pan · pinch to zoom · tap a node to open that slice
          </div>
          <div className="border-line bg-surface overflow-hidden rounded-(--radius-card) border">
            <svg
              viewBox={`0 0 ${VIEW} ${VIEW}`}
              className="h-[70vh] w-full touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            >
              <g
                transform={`translate(${view.x} ${view.y}) translate(${CENTER} ${CENTER}) scale(${view.scale}) translate(${-CENTER} ${-CENTER})`}
              >
                {/* spokes from center to hubs, and hub to topics */}
                {nodes
                  .filter((n) => n.kind === 'hub')
                  .map((hub) => (
                    <line
                      key={`spoke-${hub.id}`}
                      x1={CENTER}
                      y1={CENTER}
                      x2={hub.x}
                      y2={hub.y}
                      stroke="var(--hl-line)"
                      strokeWidth={1}
                    />
                  ))}
                {nodes
                  .filter((n) => n.kind === 'topic')
                  .map((topic) => {
                    const hub = nodes.find((n) => n.kind === 'hub' && n.category === topic.category)
                    if (hub === undefined) return null
                    return (
                      <line
                        key={`edge-${topic.id}`}
                        x1={hub.x}
                        y1={hub.y}
                        x2={topic.x}
                        y2={topic.y}
                        stroke="var(--hl-line)"
                        strokeWidth={0.75}
                      />
                    )
                  })}

                <circle cx={CENTER} cy={CENTER} r={26} fill="var(--hl-accent-dim)" />
                <text
                  x={CENTER}
                  y={CENTER + 4}
                  textAnchor="middle"
                  fill="var(--hl-accent)"
                  fontSize={13}
                  fontWeight={700}
                >
                  me
                </text>

                {nodes.map((node) => (
                  <g key={node.id} onClick={() => openNode(node)} className="cursor-pointer">
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.r}
                      fill={node.kind === 'hub' ? 'var(--hl-raised)' : 'var(--hl-surface)'}
                      stroke={node.sensitive ? 'var(--hl-danger)' : 'var(--hl-accent)'}
                      strokeOpacity={node.kind === 'hub' ? 0.9 : 0.45}
                      strokeWidth={node.kind === 'hub' ? 1.5 : 1}
                    />
                    <text
                      x={node.x}
                      y={node.y + (node.kind === 'hub' ? -4 : 3)}
                      textAnchor="middle"
                      fill="var(--hl-ink)"
                      fontSize={node.kind === 'hub' ? 12 : 9}
                      fontWeight={node.kind === 'hub' ? 700 : 400}
                    >
                      {node.label}
                    </text>
                    {node.kind === 'hub' && (
                      <text
                        x={node.x}
                        y={node.y + 12}
                        textAnchor="middle"
                        fill="var(--hl-muted)"
                        fontSize={10}
                      >
                        {node.count}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </>
      )}
    </Screen>
  )
}
