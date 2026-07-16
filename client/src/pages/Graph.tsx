import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force'
import { linksApi, type GraphNode } from '../lib/api'
import { ENTITY_META, routeForLink } from '../components/LinkedItems'
import { useToast } from '../components/Toast'

type SimNode = SimulationNodeDatum & GraphNode & { key: string }
type SimLink = SimulationLinkDatum<SimNode> & { linkId: string }

const WIDTH  = 960
const HEIGHT = 640
const NODE_RADIUS = 22

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function GraphPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)
  const [, forceRender] = useState(0)

  const simRef   = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const svgRef   = useRef<SVGSVGElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    linksApi.graph().then(({ nodes: rawNodes, edges }) => {
      if (rawNodes.length === 0) {
        setEmpty(true)
        setLoading(false)
        return
      }
      setEmpty(false)

      const simNodes: SimNode[] = rawNodes.map((n: GraphNode) => ({ ...n, key: `${n.type}:${n.id}` }))
      const nodeByKey = new Map(simNodes.map(n => [n.key, n]))
      const simLinks: SimLink[] = edges
        .map(e => ({
          linkId: e.linkId,
          source: nodeByKey.get(`${e.from.type}:${e.from.id}`) as SimNode,
          target: nodeByKey.get(`${e.to.type}:${e.to.id}`) as SimNode,
        }))
        .filter(l => l.source && l.target)

      simRef.current?.stop()

      const sim = forceSimulation<SimNode>(simNodes)
        .force('link', forceLink<SimNode, SimLink>(simLinks).id(d => d.key).distance(120).strength(0.5))
        .force('charge', forceManyBody().strength(-280))
        .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
        .force('collide', forceCollide(NODE_RADIUS + 24))
        .on('tick', () => forceRender(t => t + 1))

      simRef.current = sim
      nodesRef.current = simNodes
      linksRef.current = simLinks
      setLoading(false)
    }).catch(err => {
      toast((err as Error).message, 'error')
      setLoading(false)
    })
  }, [toast])

  useEffect(() => {
    load()
    return () => { simRef.current?.stop() }
  }, [load])

  function clientToSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    }
  }

  function handleNodeMouseDown(e: React.MouseEvent, node: SimNode) {
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let dragged = false

    node.fx = node.x
    node.fy = node.y
    simRef.current?.alphaTarget(0.3).restart()

    function onMove(ev: MouseEvent) {
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) dragged = true
      const pt = clientToSvgPoint(ev.clientX, ev.clientY)
      node.fx = pt.x
      node.fy = pt.y
    }
    function onUp() {
      node.fx = null
      node.fy = null
      simRef.current?.alphaTarget(0)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!dragged) {
        const route = routeForLink({ type: node.type, subtitle: node.subtitle })
        navigate(`${route}?open=${node.id}`)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const nodes = nodesRef.current
  const links = linksRef.current

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Links Graph</h1>
        {!loading && !empty && (
          <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {nodes.length} items · {links.length} links
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(ENTITY_META).map(([type, meta]) => (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--fg-3)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
              {meta.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading && <div style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>Loading graph…</div>}

        {!loading && empty && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 360 }}>
            <div style={{ fontSize: 28, color: 'var(--fg-4)' }}>◈</div>
            <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>Nothing linked yet.</div>
            <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>
              Link Tasks, Documents, Codes, Issues, Releases, or Commands together — from the "+ Link item" button on any of their detail panels — to see them mapped out here.
            </div>
          </div>
        )}

        {!loading && !empty && (
          <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: '100%', maxWidth: WIDTH, maxHeight: HEIGHT }}>
            {links.map(l => {
              const s = l.source as SimNode
              const t = l.target as SimNode
              return (
                <line
                  key={l.linkId}
                  x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0}
                  style={{ stroke: 'var(--line-2)', strokeWidth: 1.5 }}
                />
              )
            })}
            {nodes.map(n => {
              const meta = ENTITY_META[n.type]
              return (
                <g
                  key={n.key}
                  transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                  onMouseDown={e => handleNodeMouseDown(e, n)}
                  style={{ cursor: 'default' }}
                >
                  <title>{`${meta.label}: ${n.title}${n.subtitle ? ` (${n.subtitle})` : ''}`}</title>
                  <circle r={NODE_RADIUS} style={{ fill: `${meta.color}22`, stroke: meta.color, strokeWidth: 1.5 }} />
                  <text textAnchor="middle" dy="5" style={{ fontSize: 13, fill: meta.color, fontFamily: 'var(--font-mono)', userSelect: 'none' }}>
                    {meta.icon}
                  </text>
                  <text textAnchor="middle" y={NODE_RADIUS + 15} style={{ fontSize: 10.5, fill: 'var(--fg-2)', userSelect: 'none' }}>
                    {truncate(n.title, 18)}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}
