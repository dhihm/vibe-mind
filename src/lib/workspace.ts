import { MarkerType, type Edge, type Node, type Viewport } from '@xyflow/react'

export type NodeKind =
  | 'question'
  | 'answer'
  | 'concept'
  | 'research'
  | 'todo'
  | 'important'
export type NodeAction =
  | 'question'
  | 'answer'
  | 'concept'
  | 'research'
  | 'todo'
  | 'important'

export type WorkspaceNode = Node<
  {
    title: string
    body: string
    kind: NodeKind
    action: NodeAction
  },
  'knowledge'
>

export type WorkspaceEdge = Edge<{ relation: string }>

export interface WorkspaceDocument {
  title: string
  description: string
  nodes: WorkspaceNode[]
  edges: WorkspaceEdge[]
  viewport: Viewport
}

export const LOCAL_STORAGE_KEY = 'vibe-mind.workspace'

export const NODE_KIND_META: Record<
  NodeKind,
  {
    label: string
    shortLabel: string
    miniMapColor: string
    defaultTitle: string
    defaultBody: string
  }
> = {
  question: {
    label: 'Question node',
    shortLabel: 'Q',
    miniMapColor: '#f97316',
    defaultTitle: 'What do I want to understand?',
    defaultBody:
      'State the question clearly.\n\nAdd why this question matters or what answering it would unlock.',
  },
  answer: {
    label: 'Answer node',
    shortLabel: 'A',
    miniMapColor: '#22c55e',
    defaultTitle: 'Working answer',
    defaultBody:
      'Capture the current answer.\n\nKeep this concise first, then add supporting detail below.',
  },
  concept: {
    label: 'Concept node',
    shortLabel: 'Concept',
    miniMapColor: '#0ea5e9',
    defaultTitle: 'Core concept',
    defaultBody:
      'Define the concept clearly, then connect it back to the surrounding nodes.',
  },
  research: {
    label: 'Research node',
    shortLabel: 'Research',
    miniMapColor: '#f59e0b',
    defaultTitle: 'Claim to verify',
    defaultBody:
      'State the exact claim, uncertainty, or comparison to verify.\n\nThen add the highest-signal evidence or experiment that would confirm or refute it.',
  },
  todo: {
    label: 'Todo item',
    shortLabel: 'Todo',
    miniMapColor: '#ec4899',
    defaultTitle: 'Next step',
    defaultBody:
      'State the concrete next action.\n\nAdd what needs to be checked, built, or followed up.',
  },
  important: {
    label: 'Important note',
    shortLabel: 'Important',
    miniMapColor: '#ef4444',
    defaultTitle: 'Key point',
    defaultBody:
      'Capture the key takeaway, warning, or constraint.\n\nKeep it short and easy to scan later.',
  },
}

export const NODE_ACTION_META: Record<
  NodeAction,
  {
    label: string
    shortLabel: string
    kind: NodeKind
    defaultTitle: string
    defaultBody: string
    defaultRelation?: string
  }
> = {
  question: {
    label: 'Ask next',
    shortLabel: 'Ask',
    kind: 'question',
    defaultTitle: 'What do I want to understand?',
    defaultBody:
      'State the next question clearly.\n\nAdd what makes it worth asking now.',
    defaultRelation: 'raises',
  },
  answer: {
    label: 'Explain',
    shortLabel: 'Explain',
    kind: 'answer',
    defaultTitle: 'Working answer',
    defaultBody:
      'Capture the current answer.\n\nKeep this concise first, then add supporting detail below.',
    defaultRelation: 'answered by',
  },
  concept: {
    label: 'Define',
    shortLabel: 'Define',
    kind: 'concept',
    defaultTitle: 'Core concept',
    defaultBody:
      'Define the concept clearly, then connect it back to the surrounding nodes.',
    defaultRelation: 'uses',
  },
  research: {
    label: 'Investigate',
    shortLabel: 'Investigate',
    kind: 'research',
    defaultTitle: 'Claim to verify',
    defaultBody:
      'State the exact claim, uncertainty, or comparison to verify.\n\nAdd the highest-signal evidence, comparison, or experiment that would settle it.',
    defaultRelation: 'requires evidence',
  },
  todo: {
    label: 'Add todo',
    shortLabel: 'Todo',
    kind: 'todo',
    defaultTitle: 'Next step',
    defaultBody:
      'State the concrete next action.\n\nAdd what needs to be checked, built, or followed up.',
    defaultRelation: 'tracks',
  },
  important: {
    label: 'Mark important',
    shortLabel: 'Important',
    kind: 'important',
    defaultTitle: 'Key point',
    defaultBody:
      'Capture the key takeaway, warning, or constraint.\n\nKeep it short and easy to scan later.',
    defaultRelation: 'highlights',
  },
}

export function inferActionFromKind(kind: NodeKind): NodeAction {
  return kind
}

export function createWorkspaceNode(
  kind: NodeKind,
  position: { x: number; y: number },
  action = inferActionFromKind(kind),
): WorkspaceNode {
  const actionMeta = NODE_ACTION_META[action]
  return {
    id: crypto.randomUUID(),
    type: 'knowledge',
    position,
    data: {
      title: actionMeta.defaultTitle,
      body: actionMeta.defaultBody,
      kind: actionMeta.kind,
      action,
    },
  }
}

function defaultRelation(sourceKind: NodeKind, targetKind: NodeKind): string {
  if (sourceKind === 'question' && targetKind === 'answer') {
    return 'answered by'
  }
  if (sourceKind === 'question' && targetKind === 'research') {
    return 'requires evidence'
  }
  if (sourceKind === 'answer' && targetKind === 'concept') {
    return 'uses'
  }
  if (sourceKind === 'answer' && targetKind === 'question') {
    return 'raises'
  }
  if (sourceKind === 'research' && targetKind === 'answer') {
    return 'tests'
  }
  if (targetKind === 'todo') {
    return 'tracks'
  }
  if (targetKind === 'important') {
    return 'highlights'
  }
  if (targetKind === 'question') {
    return 'raises'
  }
  if (targetKind === 'answer') {
    return 'answered by'
  }
  if (targetKind === 'concept') {
    return 'uses'
  }
  if (targetKind === 'research') {
    return 'requires evidence'
  }
  return 'connects to'
}

export function createWorkspaceEdge(
  source: WorkspaceNode,
  target: WorkspaceNode,
): WorkspaceEdge {
  const relation = defaultRelation(source.data.kind, target.data.kind)

  return {
    id: crypto.randomUUID(),
    source: source.id,
    target: target.id,
    type: 'smoothstep',
    label: relation,
    data: { relation },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#475467',
      width: 18,
      height: 18,
    },
    style: {
      stroke: '#475467',
      strokeWidth: 1.75,
    },
    labelStyle: {
      fill: '#344054',
      fontSize: 12,
      fontWeight: 700,
    },
    labelBgStyle: {
      fill: '#f8fafc',
      fillOpacity: 0.92,
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999,
  }
}

export function emptyWorkspace(): WorkspaceDocument {
  const node = createWorkspaceNode('question', { x: 80, y: 120 })
  node.data.title = 'What do I want to learn next?'
  node.data.body =
    'Start with the core question.\n\nThen branch into answers, concepts, research plans, and new questions.'

  return {
    title: 'Untitled workspace',
    description: 'A graph-first thinking space.',
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.8 },
  }
}

interface GraphEnvelope {
  version: number
  viewport: Viewport
  nodes: Array<{
    id: string
    position: { x: number; y: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    relation: string
  }>
}

type LegacyNodeKind = NodeKind | 'problem' | 'follow_up'
type LegacyNodeAction = NodeAction | 'follow_up'

function normalizeLegacyKind(kind: LegacyNodeKind): NodeKind {
  if (kind === 'problem' || kind === 'follow_up') {
    return 'question'
  }
  return kind
}

function normalizeLegacyAction(action?: LegacyNodeAction, kind?: LegacyNodeKind): NodeAction {
  if (action === 'follow_up') {
    return 'question'
  }
  if (
    action === 'question' ||
    action === 'answer' ||
    action === 'concept' ||
    action === 'research' ||
    action === 'todo' ||
    action === 'important'
  ) {
    return action
  }
  return inferActionFromKind(normalizeLegacyKind(kind ?? 'concept'))
}

export function serializeWorkspace(doc: WorkspaceDocument): string {
  const graph: GraphEnvelope = {
    version: 1,
    viewport: doc.viewport,
    nodes: doc.nodes.map((node) => ({
      id: node.id,
      position: node.position,
    })),
    edges: doc.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.data?.relation ?? String(edge.label ?? ''),
    })),
  }

  const sections = doc.nodes
    .map((node) => {
      const metadata = {
        title: node.data.title,
        kind: node.data.kind,
        action: node.data.action,
      }

      return [
        `## Node: ${node.id}`,
        '```vibemind-node-meta',
        JSON.stringify(metadata, null, 2),
        '```',
        node.data.body.trim(),
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return [
    `# ${doc.title}`,
    '',
    doc.description,
    '',
    '```vibemind-graph',
    JSON.stringify(graph, null, 2),
    '```',
    '',
    sections,
    '',
  ].join('\n')
}

export function deserializeWorkspace(markdown: string): WorkspaceDocument {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n')
  const titleMatch = normalizedMarkdown.match(/^#\s+(.+)$/m)
  const graphMatch = normalizedMarkdown.match(/```vibemind-graph\n([\s\S]*?)\n```/)

  if (!titleMatch || !graphMatch) {
    throw new Error('Invalid Vibe Mind workspace file.')
  }

  const title = titleMatch[1].trim()
  const titleLine = titleMatch[0]
  const graphBlock = graphMatch[0]
  const description = normalizedMarkdown
    .slice(
      normalizedMarkdown.indexOf(titleLine) + titleLine.length,
      normalizedMarkdown.indexOf(graphBlock),
    )
    .trim()
  const graph = JSON.parse(graphMatch[1]) as GraphEnvelope

  const nodeSectionRegex =
    /## Node: ([^\n]+)\n```vibemind-node-meta\n([\s\S]*?)\n```\n([\s\S]*?)(?=\n(?:---\n\n)?## Node: |\n*$)/g
  const nodesById = new Map<string, WorkspaceNode>()

  for (const match of normalizedMarkdown.matchAll(nodeSectionRegex)) {
    const [, id, metadataJson, body] = match
    const metadata = JSON.parse(metadataJson) as {
      title: string
      kind: LegacyNodeKind
      action?: LegacyNodeAction
    }
    const position = graph.nodes.find((node) => node.id === id)?.position ?? {
      x: 0,
      y: 0,
    }
    const normalizedKind = normalizeLegacyKind(metadata.kind)
    const normalizedAction = normalizeLegacyAction(metadata.action, metadata.kind)

    nodesById.set(id, {
      id,
      type: 'knowledge',
      position,
      data: {
        title: metadata.title,
        kind: normalizedKind,
        action: normalizedAction,
        body: body.trim(),
      },
    })
  }

  const nodes = graph.nodes
    .map((graphNode) => nodesById.get(graphNode.id))
    .filter((node): node is WorkspaceNode => Boolean(node))

  const edges = graph.edges.map((edge) => ({
    ...createWorkspaceEdge(
      nodesById.get(edge.source) ?? createWorkspaceNode('concept', { x: 0, y: 0 }),
      nodesById.get(edge.target) ?? createWorkspaceNode('concept', { x: 0, y: 0 }),
    ),
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.relation,
    data: { relation: edge.relation },
  }))

  return {
    title,
    description,
    nodes,
    edges,
    viewport: graph.viewport ?? { x: 0, y: 0, zoom: 0.8 },
  }
}
