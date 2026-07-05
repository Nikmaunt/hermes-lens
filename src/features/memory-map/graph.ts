import type { MemoryCategory, MemoryItem } from '@/schemas'

/*
 * Pure graph model + physics for the Memory Map. No DOM, no timers — the
 * screen owns scheduling; everything here is a deterministic function of
 * its inputs so it can be unit-tested.
 *
 * Why hand-rolled 2D instead of a library or 3D: at ~100 nodes an O(n²)
 * force pass is ~10k operations per frame — far below any budget on a
 * mid-range WebView — so d3-force (~9 KB gz) buys nothing we need, and a
 * 3D engine (three.js ≥ ~150 KB gz, WebGL-on-WebView risks, much harder
 * labels/masking/a11y) fails the size and fps gates outright. The Obsidian
 * feel comes from the physics, not the dimension.
 */

export interface GraphNode {
  id: string
  kind: 'center' | 'hub' | 'topic'
  /** Raw label — use displayLabel() for rendering (masking, truncation). */
  label: string
  category: MemoryCategory | null
  topic?: string
  count: number
  r: number
  sensitive: boolean
  x: number
  y: number
  vx: number
  vy: number
  /** Pinned position while the user drags the node; null = free. */
  fx: number | null
  fy: number | null
}

export interface GraphLink {
  from: number
  to: number
  /** Spring rest length in world units. */
  rest: number
}

export interface Graph {
  nodes: GraphNode[]
  links: GraphLink[]
}

export const PHYSICS = {
  /** Pairwise push, f = REPULSION / d² (capped below MIN_DIST). */
  REPULSION: 26000,
  MIN_DIST: 24,
  /** Link spring stiffness. */
  SPRING: 0.04,
  /** Weak pull of every node toward the origin, keeps the cloud compact. */
  CENTER_PULL: 0.012,
  /** Velocity kept per tick — the "syrup" that makes motion feel organic. */
  DAMPING: 0.6,
  /** Heat decay per tick; the sim freezes below ALPHA_MIN (no jitter).
   *  0.97 ≈ two-second entrance bloom at 60 fps. */
  ALPHA_DECAY: 0.97,
  ALPHA_MIN: 0.02,
  HUB_RING: 165,
  TOPIC_DIST: 62,
} as const

const HUB_FONT = 14
const TOPIC_FONT = 12
export const LABEL_FONTS = { center: HUB_FONT, hub: HUB_FONT, topic: TOPIC_FONT } as const

/** Deterministic build: sorted categories/topics, radial seed layout. */
export function buildGraph(items: MemoryItem[]): Graph {
  const byCategory = new Map<MemoryCategory, MemoryItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.category)
    if (list === undefined) byCategory.set(item.category, [item])
    else list.push(item)
  }

  const nodes: GraphNode[] = []
  const links: GraphLink[] = []
  if (items.length === 0) return { nodes, links }

  nodes.push({
    id: 'center',
    kind: 'center',
    label: 'me',
    category: null,
    count: items.length,
    r: 22,
    sensitive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
  })

  const categories = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))
  categories.forEach(([category, catItems], i) => {
    const hubAngle = (i / categories.length) * Math.PI * 2 - Math.PI / 2
    const hubIndex = nodes.length
    nodes.push({
      id: `hub-${category}`,
      kind: 'hub',
      label: category,
      category,
      count: catItems.length,
      r: 16 + Math.min(12, catItems.length * 1.2),
      sensitive: false,
      x: Math.cos(hubAngle) * PHYSICS.HUB_RING,
      y: Math.sin(hubAngle) * PHYSICS.HUB_RING,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
    })
    links.push({ from: 0, to: hubIndex, rest: PHYSICS.HUB_RING })

    const byTopic = new Map<string, MemoryItem[]>()
    for (const item of catItems) {
      const list = byTopic.get(item.topic)
      if (list === undefined) byTopic.set(item.topic, [item])
      else list.push(item)
    }
    const topics = [...byTopic.entries()].sort(
      ([ta, a], [tb, b]) => b.length - a.length || ta.localeCompare(tb),
    )
    topics.forEach(([topic, topicItems], j) => {
      const spread = Math.PI * 0.9
      const theta =
        topics.length === 1
          ? hubAngle
          : hubAngle - spread / 2 + (j / (topics.length - 1)) * spread
      const hub = nodes[hubIndex]
      if (hub === undefined) return
      const r = 8 + Math.min(9, topicItems.length * 1.8)
      nodes.push({
        id: `topic-${category}-${topic}`,
        kind: 'topic',
        label: topic,
        category,
        topic,
        count: topicItems.length,
        r,
        sensitive: topicItems.some((t) => t.sensitivity === 'sensitive'),
        x: hub.x + Math.cos(theta) * PHYSICS.TOPIC_DIST,
        y: hub.y + Math.sin(theta) * PHYSICS.TOPIC_DIST,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
      })
      links.push({ from: hubIndex, to: nodes.length - 1, rest: PHYSICS.TOPIC_DIST + hub.r + r })
    })
  })
  return { nodes, links }
}

/**
 * One physics tick. Mutates positions/velocities in place (this runs every
 * frame — allocation-free by design). Returns the largest node speed so the
 * caller can decide the layout has settled.
 */
export function stepSimulation(graph: Graph, alpha: number): number {
  const { nodes, links } = graph
  const { REPULSION, MIN_DIST, SPRING, CENTER_PULL, DAMPING } = PHYSICS

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i] as GraphNode
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j] as GraphNode
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) {
        // Coincident nodes: nudge apart deterministically by index.
        dx = 0.1 * (j - i)
        dy = 0.05
        d2 = dx * dx + dy * dy
      }
      const d = Math.sqrt(d2)
      const clamped = Math.max(d, MIN_DIST)
      const f = (REPULSION / (clamped * clamped)) * alpha
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      a.vx -= fx
      a.vy -= fy
      b.vx += fx
      b.vy += fy
    }
  }

  for (const link of links) {
    const a = nodes[link.from] as GraphNode
    const b = nodes[link.to] as GraphNode
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.max(1, Math.hypot(dx, dy))
    const f = (d - link.rest) * SPRING * alpha
    const fx = (dx / d) * f
    const fy = (dy / d) * f
    a.vx += fx
    a.vy += fy
    b.vx -= fx
    b.vy -= fy
  }

  let maxSpeed = 0
  for (const node of nodes) {
    node.vx -= node.x * CENTER_PULL * alpha
    node.vy -= node.y * CENTER_PULL * alpha
    node.vx *= DAMPING
    node.vy *= DAMPING
    if (node.fx !== null && node.fy !== null) {
      node.x = node.fx
      node.y = node.fy
      node.vx = 0
      node.vy = 0
      continue
    }
    node.x += node.vx
    node.y += node.vy
    maxSpeed = Math.max(maxSpeed, Math.abs(node.vx), Math.abs(node.vy))
  }
  return maxSpeed
}

/**
 * Run the sim to equilibrium synchronously — used to pre-settle the initial
 * layout and as the whole story under prefers-reduced-motion.
 */
export function settleGraph(graph: Graph, maxTicks = 600): void {
  let alpha = 1
  for (let tick = 0; tick < maxTicks && alpha > PHYSICS.ALPHA_MIN; tick++) {
    stepSimulation(graph, alpha)
    alpha *= PHYSICS.ALPHA_DECAY
  }
  for (const node of graph.nodes) {
    node.vx = 0
    node.vy = 0
  }
}

export const LABEL_MAX_CHARS = 14
export const MASKED_LABEL = '· · ·'

/**
 * What the node shows at rest: sensitive topics stay masked (the topic name
 * itself can give the secret away), long labels get an ellipsis. Pass
 * `full: true` for the focused node — masking still wins over "full".
 */
export function displayLabel(node: Pick<GraphNode, 'label' | 'sensitive'>, full = false): string {
  if (node.sensitive) return MASKED_LABEL
  if (full || node.label.length <= LABEL_MAX_CHARS) return node.label
  return `${node.label.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`
}

/**
 * Collision-aware label placement: center first, then hubs, then topics by
 * fact count. A label is shown only if its estimated box (below the node)
 * does not overlap an already-placed one. Returns ids of visible labels.
 */
export function placeLabels(nodes: readonly GraphNode[]): Set<string> {
  const order = [...nodes].sort((a, b) => {
    const rank = (n: GraphNode) => (n.kind === 'center' ? 0 : n.kind === 'hub' ? 1 : 2)
    return rank(a) - rank(b) || b.count - a.count || a.id.localeCompare(b.id)
  })
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = []
  const visible = new Set<string>()
  for (const node of order) {
    if (node.kind === 'center') {
      visible.add(node.id) // "me" sits inside its circle, never collides
      continue
    }
    const font = LABEL_FONTS[node.kind]
    const text = displayLabel(node)
    const w = Math.max(18, text.length * font * 0.62)
    const h = font + 4
    const x1 = node.x - w / 2
    const y1 = node.y + node.r + 3
    const box = { x1, y1, x2: x1 + w, y2: y1 + h }
    const collides = placed.some(
      (p) => box.x1 < p.x2 && box.x2 > p.x1 && box.y1 < p.y2 && box.y2 > p.y1,
    )
    if (!collides) {
      placed.push(box)
      visible.add(node.id)
    }
  }
  return visible
}

/** Axis-aligned bounds of the settled graph (for the re-center fit). */
export function graphBounds(nodes: readonly GraphNode[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r)
    minY = Math.min(minY, node.y - node.r)
    maxX = Math.max(maxX, node.x + node.r)
    maxY = Math.max(maxY, node.y + node.r)
  }
  if (minX > maxX) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}
