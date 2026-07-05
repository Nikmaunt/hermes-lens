import { describe, expect, it } from 'vitest'
import type { MemoryItem } from '@/schemas'
import {
  buildGraph,
  displayLabel,
  graphBounds,
  MASKED_LABEL,
  PHYSICS,
  placeLabels,
  settleGraph,
  stepSimulation,
} from './graph'

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: 'mem-1',
  category: 'preferences',
  topic: 'coffee',
  fact: 'flat white, no sugar',
  sensitivity: 'normal',
  source: 'telegram',
  learnedAt: '2026-07-01T10:00:00+02:00',
  updatedAt: '2026-07-01T10:00:00+02:00',
  pendingFlag: null,
  ...over,
})

const sample = (): MemoryItem[] => [
  item({ id: 'm1', category: 'preferences', topic: 'coffee' }),
  item({ id: 'm2', category: 'preferences', topic: 'coffee' }),
  item({ id: 'm3', category: 'preferences', topic: 'music' }),
  item({ id: 'm4', category: 'health', topic: 'sleep' }),
  item({ id: 'm5', category: 'health', topic: 'meds', sensitivity: 'sensitive' }),
  item({ id: 'm6', category: 'finance', topic: 'salary', sensitivity: 'sensitive' }),
  item({ id: 'm7', category: 'finance', topic: 'salary' }),
]

describe('buildGraph', () => {
  it('creates the center, one hub per category and one node per topic', () => {
    const g = buildGraph(sample())
    expect(g.nodes.filter((n) => n.kind === 'center')).toHaveLength(1)
    expect(g.nodes.filter((n) => n.kind === 'hub').map((n) => n.label)).toEqual([
      'finance',
      'health',
      'preferences',
    ])
    expect(g.nodes.filter((n) => n.kind === 'topic')).toHaveLength(5)
    // every topic links to its hub, every hub to the center
    expect(g.links).toHaveLength(3 + 5)
  })

  it('is deterministic regardless of item order', () => {
    const a = buildGraph(sample())
    const b = buildGraph([...sample()].reverse())
    expect(b.nodes.map((n) => n.id)).toEqual(a.nodes.map((n) => n.id))
  })

  it('sizes nodes by fact count', () => {
    const g = buildGraph(sample())
    const coffee = g.nodes.find((n) => n.id === 'topic-preferences-coffee')
    const music = g.nodes.find((n) => n.id === 'topic-preferences-music')
    expect((coffee?.r ?? 0) > (music?.r ?? 0)).toBe(true)
    expect(coffee?.count).toBe(2)
  })

  it('flags topics with any sensitive fact', () => {
    const g = buildGraph(sample())
    expect(g.nodes.find((n) => n.id === 'topic-finance-salary')?.sensitive).toBe(true)
    expect(g.nodes.find((n) => n.id === 'topic-health-sleep')?.sensitive).toBe(false)
  })

  it('returns an empty graph for no items', () => {
    expect(buildGraph([])).toEqual({ nodes: [], links: [] })
  })
})

describe('displayLabel', () => {
  it('masks sensitive topics even when asked for the full label', () => {
    expect(displayLabel({ label: 'salary', sensitive: true })).toBe(MASKED_LABEL)
    expect(displayLabel({ label: 'salary', sensitive: true }, true)).toBe(MASKED_LABEL)
  })

  it('truncates long labels with an ellipsis, full on focus', () => {
    const label = 'driving licence photo'
    const short = displayLabel({ label, sensitive: false })
    expect(short.endsWith('…')).toBe(true)
    expect(short.length).toBeLessThanOrEqual(14)
    expect(displayLabel({ label, sensitive: false }, true)).toBe(label)
  })

  it('leaves short labels alone', () => {
    expect(displayLabel({ label: 'coffee', sensitive: false })).toBe('coffee')
  })
})

describe('simulation', () => {
  it('settles into a still, non-jittery equilibrium', () => {
    const g = buildGraph(sample())
    settleGraph(g)
    const after = stepSimulation(g, PHYSICS.ALPHA_MIN)
    expect(after).toBeLessThan(0.5) // residual drift under half a unit/frame
    for (const n of g.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
  })

  it('keeps settled nodes apart and within a sane radius', () => {
    const g = buildGraph(sample())
    settleGraph(g)
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        const a = g.nodes[i]
        const b = g.nodes[j]
        if (a === undefined || b === undefined) continue
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(PHYSICS.MIN_DIST / 2)
      }
    }
    const bounds = graphBounds(g.nodes)
    expect(Math.max(Math.abs(bounds.minX), bounds.maxX)).toBeLessThan(900)
    expect(Math.max(Math.abs(bounds.minY), bounds.maxY)).toBeLessThan(900)
  })

  it('settling is deterministic', () => {
    const a = buildGraph(sample())
    const b = buildGraph(sample())
    settleGraph(a)
    settleGraph(b)
    expect(a.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)])).toEqual(
      b.nodes.map((n) => [n.id, n.x.toFixed(6), n.y.toFixed(6)]),
    )
  })

  it('a pinned (dragged) node stays under the finger', () => {
    const g = buildGraph(sample())
    settleGraph(g)
    const node = g.nodes.find((n) => n.kind === 'topic')
    expect(node).toBeDefined()
    if (node === undefined) return
    node.fx = 300
    node.fy = -200
    stepSimulation(g, 0.3)
    expect(node.x).toBe(300)
    expect(node.y).toBe(-200)
    // released, it springs back toward its cluster
    node.fx = null
    node.fy = null
    let alpha = 0.3
    for (let i = 0; i < 200; i++) {
      stepSimulation(g, alpha)
      alpha *= PHYSICS.ALPHA_DECAY
    }
    expect(Math.hypot(node.x - 300, node.y - -200)).toBeGreaterThan(40)
  })
})

describe('placeLabels', () => {
  it('prioritizes the center and hubs, culls colliding topic labels', () => {
    const g = buildGraph(sample())
    settleGraph(g)
    const visible = placeLabels(g.nodes)
    expect(visible.has('center')).toBe(true)
    for (const hub of g.nodes.filter((n) => n.kind === 'hub')) {
      expect(visible.has(hub.id)).toBe(true)
    }
  })

  it('culls the lower-priority label when two nodes sit on top of each other', () => {
    const g = buildGraph(sample())
    settleGraph(g)
    const topics = g.nodes.filter((n) => n.kind === 'topic')
    const [big, small] = [...topics].sort((a, b) => b.count - a.count)
    if (big === undefined || small === undefined) throw new Error('need two topics')
    small.x = big.x
    small.y = big.y
    const visible = placeLabels(g.nodes)
    expect(visible.has(big.id)).toBe(true)
    expect(visible.has(small.id)).toBe(false)
  })
})
