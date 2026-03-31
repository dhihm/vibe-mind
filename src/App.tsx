import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import '@xyflow/react/dist/style.css'
import './App.css'
import {
  LOCAL_STORAGE_KEY,
  NODE_ACTION_META,
  NODE_KIND_META,
  createWorkspaceEdge,
  createWorkspaceNode,
  deserializeWorkspace,
  emptyWorkspace,
  inferActionFromKind,
  serializeWorkspace,
  type NodeAction,
  type NodeKind,
  type WorkspaceDocument,
  type WorkspaceEdge,
  type WorkspaceNode,
} from './lib/workspace'
import { sampleWorkspace } from './sampleWorkspace'

interface ProviderStatus {
  available: boolean
  ready: boolean
  statusText: string
  displayStatus?: string
  authSource?: string
  defaultModel: string
  reasoningEffort?: string
}

const INSPECTOR_WIDTH_KEY = 'vibe-mind.inspector-width'
const ACTIVE_PROVIDER_KEY = 'vibe-mind.active-provider'
const MIN_INSPECTOR_WIDTH = 300
const MIN_CANVAS_WIDTH = 140
const SELECTION_POPOVER_WIDTH = 560
const SELECTION_POPOVER_HEIGHT = 300
const VIEWPORT_MARGIN = 12
const SELECTION_POPOVER_OFFSET_X = 20
const SELECTION_POPOVER_OFFSET_Y = 28
const CUSTOM_RELATION_VALUE = '__custom__'
type ProviderKey = 'codex' | 'claude'

type KnowledgeNodeData = WorkspaceNode['data'] & {
  onOpenComposer?: (event: ReactMouseEvent<HTMLDivElement>) => void
}

type RenderKnowledgeNode = Node<KnowledgeNodeData, 'knowledge'>

function KnowledgeNode({ id, data, selected }: NodeProps<RenderKnowledgeNode>) {
  const meta = NODE_KIND_META[data.kind]
  const preview =
    data.body.split('\n').find((line: string) => line.trim()) ?? 'No detail yet.'

  return (
    <div
      data-node-id={id}
      className={`knowledge-node knowledge-node--${data.kind} ${
        selected ? 'knowledge-node--selected' : ''
      }`}
      onContextMenu={(event) => data.onOpenComposer?.(event)}
    >
      <Handle className="knowledge-node__handle" position={Position.Left} type="target" />
      <span className="knowledge-node__eyebrow">{meta.shortLabel}</span>
      <strong className="knowledge-node__title">{data.title}</strong>
      <span className="knowledge-node__preview">{preview}</span>
      <Handle className="knowledge-node__handle" position={Position.Right} type="source" />
    </div>
  )
}

interface ContextComposerState {
  sourceNodeId: string
  x: number
  y: number
  action: NodeAction
  title: string
  body: string
  relation: string
}

interface PreviewSelectionState {
  sourceNodeId: string
  text: string
  prompt: string
  x: number
  y: number
}

const nodeTypes = {
  knowledge: KnowledgeNode,
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function initialWorkspace(): WorkspaceDocument {
  if (typeof window === 'undefined') {
    return sampleWorkspace
  }

  const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY)
  if (!saved) {
    return sampleWorkspace
  }

  try {
    return deserializeWorkspace(saved)
  } catch {
    return sampleWorkspace
  }
}

function clipText(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

function parseGeneratedNodeAnswer(rawAnswer: string) {
  const normalized = rawAnswer.trim()
  const match = normalized.match(/^TITLE:\s*(.+?)\nBODY:\s*\n?([\s\S]+)$/i)

  if (!match) {
    return {
      title: '',
      body: normalized,
    }
  }

  return {
    title: match[1].trim(),
    body: match[2].trim(),
  }
}

function clearBrowserSelection() {
  if (typeof window === 'undefined') {
    return
  }

  window.getSelection()?.removeAllRanges()
}

function getMaxInspectorWidth() {
  if (typeof window === 'undefined') {
    return 960
  }

  return Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH)
}

function getSelectionPopoverPosition(rect: DOMRect) {
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left + SELECTION_POPOVER_OFFSET_X),
    window.innerWidth - SELECTION_POPOVER_WIDTH - VIEWPORT_MARGIN,
  )
  const belowTop = rect.bottom + SELECTION_POPOVER_OFFSET_Y
  const aboveTop = rect.top - SELECTION_POPOVER_HEIGHT - SELECTION_POPOVER_OFFSET_Y
  const top =
    belowTop + SELECTION_POPOVER_HEIGHT <= window.innerHeight - VIEWPORT_MARGIN
      ? belowTop
      : Math.max(VIEWPORT_MARGIN, aboveTop)

  return { x: left, y: top }
}

function getChildOffset(kind: NodeKind, sourceNode?: WorkspaceNode | null) {
  if (!sourceNode) {
    return { x: 80, y: 120 }
  }

  if (kind === 'answer') {
    return { x: sourceNode.position.x + 300, y: sourceNode.position.y }
  }

  if (kind === 'concept') {
    return { x: sourceNode.position.x + 240, y: Math.max(40, sourceNode.position.y - 150) }
  }

  if (kind === 'question') {
    return { x: sourceNode.position.x + 240, y: sourceNode.position.y + 150 }
  }

  if (kind === 'research') {
    return { x: sourceNode.position.x + 320, y: sourceNode.position.y + 180 }
  }

  if (kind === 'todo') {
    return { x: sourceNode.position.x + 320, y: sourceNode.position.y - 220 }
  }

  if (kind === 'important') {
    return { x: sourceNode.position.x + 360, y: sourceNode.position.y - 40 }
  }

  return { x: sourceNode.position.x + 240, y: sourceNode.position.y + 120 }
}

function uniqueRelations(relations: string[]) {
  return Array.from(new Set(relations))
}

function isCaptureOnlyAction(action: NodeAction) {
  return action === 'todo' || action === 'important'
}

function buildInstantCaptureNodeData({
  action,
  draftTitle,
  draftBody,
  selectionText,
}: {
  action: NodeAction
  draftTitle?: string
  draftBody?: string
  selectionText?: string
}) {
  const rawPrimary = (selectionText?.trim() || draftBody?.trim() || '').replace(/\s+/g, ' ')
  const fallbackTitle =
    rawPrimary.split(/[.!?\n]/)[0]?.trim() || NODE_ACTION_META[action].defaultTitle
  const title = draftTitle?.trim() || clipText(fallbackTitle, 56)
  const bodyParts = [selectionText?.trim(), draftBody?.trim()].filter(
    (entry, index, collection): entry is string =>
      Boolean(entry) && collection.indexOf(entry) === index,
  )

  return {
    title,
    body: bodyParts.join('\n\n') || NODE_ACTION_META[action].defaultBody,
  }
}

function getSuggestedRelations(action?: NodeAction) {
  const primary = action ? [NODE_ACTION_META[action].defaultRelation ?? 'connects to'] : []

  return uniqueRelations([
    ...primary,
    'answered by',
    'raises',
    'uses',
    'requires evidence',
    'tracks',
    'highlights',
    'tests',
    'supports',
    'connects to',
  ])
}

function AppShell() {
  const [initialDoc] = useState<WorkspaceDocument>(() => initialWorkspace())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewBodyRef = useRef<HTMLDivElement>(null)
  const resizeStateRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const composerOpenGuardRef = useRef(0)
  const reactFlowRef = useRef<ReactFlowInstance<WorkspaceNode, WorkspaceEdge> | null>(
    null,
  )
  const [title, setTitle] = useState(initialDoc.title)
  const [description, setDescription] = useState(initialDoc.description)
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkspaceNode>(initialDoc.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkspaceEdge>(initialDoc.edges)
  const [viewport, setViewport] = useState<Viewport>(initialDoc.viewport)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialDoc.nodes[0]?.id ?? null,
  )
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [codexStatus, setCodexStatus] = useState<ProviderStatus | null>(null)
  const [claudeStatus, setClaudeStatus] = useState<ProviderStatus | null>(null)
  const [activeProvider, setActiveProvider] = useState<ProviderKey>(() => {
    if (typeof window === 'undefined') {
      return 'codex'
    }

    const saved = window.localStorage.getItem(ACTIVE_PROVIDER_KEY)
    return saved === 'claude' ? 'claude' : 'codex'
  })
  const [model, setModel] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isStackedLayout, setIsStackedLayout] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth <= 1120,
  )
  const [contextComposer, setContextComposer] = useState<ContextComposerState | null>(null)
  const [previewSelection, setPreviewSelection] = useState<PreviewSelectionState | null>(null)
  const [isComposerGenerating, setIsComposerGenerating] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [selectionActionPending, setSelectionActionPending] = useState<NodeAction | null>(
    null,
  )
  const [isComposerCustomRelation, setIsComposerCustomRelation] = useState(false)
  const [isEdgeCustomRelation, setIsEdgeCustomRelation] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return 380
    }

    const saved = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY))
    return Number.isFinite(saved)
      ? Math.min(getMaxInspectorWidth(), Math.max(MIN_INSPECTOR_WIDTH, saved))
      : 380
  })
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [lastGeneration, setLastGeneration] = useState<string | null>(null)
  const activeProviderStatus = activeProvider === 'claude' ? claudeStatus : codexStatus
  const effectiveModel = model.trim() || activeProviderStatus?.defaultModel || ''

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  )
  const selectedNodeAction = selectedNode?.data.action ?? null
  const composerRelationOptions = getSuggestedRelations(contextComposer?.action)
  const selectedEdgeRelationOptions = getSuggestedRelations()
  const selectedEdgeRelationValue =
    selectedEdge && selectedEdgeRelationOptions.includes(selectedEdge.data?.relation ?? '')
      ? (selectedEdge.data?.relation ?? '')
      : CUSTOM_RELATION_VALUE
  const selectedNodeConnections = useMemo(() => {
    if (!selectedNode) {
      return []
    }

    return edges
      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map((edge) => {
        const isOutgoing = edge.source === selectedNode.id
        const peerId = isOutgoing ? edge.target : edge.source
        const peerNode = nodes.find((node) => node.id === peerId)
        if (!peerNode) {
          return null
        }

        return {
          id: edge.id,
          direction: isOutgoing ? 'outgoing' : 'incoming',
          relation: edge.data?.relation ?? String(edge.label ?? 'connects to'),
          peerTitle: peerNode.data.title,
          peerKind: peerNode.data.kind,
          peerAction: peerNode.data.action,
        }
      })
      .filter((entry) => entry !== null)
  }, [edges, nodes, selectedNode])
  const todoNodes = useMemo(
    () => nodes.filter((node) => node.data.kind === 'todo'),
    [nodes],
  )
  const importantNodes = useMemo(
    () => nodes.filter((node) => node.data.kind === 'important'),
    [nodes],
  )

  function snapshotDocument(nextViewport = viewport): WorkspaceDocument {
    return {
      title,
      description,
      nodes,
      edges,
      viewport: nextViewport,
    }
  }

  function applyWorkspace(doc: WorkspaceDocument) {
    setTitle(doc.title)
    setDescription(doc.description)
    setNodes(doc.nodes)
    setEdges(doc.edges)
    setViewport(doc.viewport)
    setSelectedNodeId(doc.nodes[0]?.id ?? null)
    setSelectedEdgeId(null)
    reactFlowRef.current?.setViewport(doc.viewport, { duration: 0 })
  }

  function saveToBrowser(nextViewport = viewport) {
    const doc = snapshotDocument(nextViewport)
    window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeWorkspace(doc))
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const doc = {
      title,
      description,
      nodes,
      edges,
      viewport,
    }
    window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeWorkspace(doc))
  }, [title, description, nodes, edges, viewport])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth))
  }, [inspectorWidth])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(ACTIVE_PROVIDER_KEY, activeProvider)
  }, [activeProvider])

  useEffect(() => {
    function handleResize() {
      setIsStackedLayout(window.innerWidth <= 1120)
      setInspectorWidth((current) =>
        Math.min(getMaxInspectorWidth(), Math.max(MIN_INSPECTOR_WIDTH, current)),
      )
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const nextDefaultModel =
      activeProvider === 'claude' ? claudeStatus?.defaultModel : codexStatus?.defaultModel

    setModel((current) => current || nextDefaultModel || '')
  }, [activeProvider, claudeStatus?.defaultModel, codexStatus?.defaultModel])

  useEffect(() => {
    const controller = new AbortController()

    async function loadProviderStatus() {
      try {
        const response = await fetch('/api/providers/status', {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Failed to load AI provider status.')
        }

        const data = (await response.json()) as {
          codex: ProviderStatus
          claude: ProviderStatus
        }
        setCodexStatus(data.codex)
        setClaudeStatus(data.claude)
        setModel((current) => current || data.codex.defaultModel)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setGenerationError('Could not reach the local AI provider server.')
        }
      }
    }

    void loadProviderStatus()

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      if (!resizeStateRef.current) {
        return
      }

      const deltaX = resizeStateRef.current.startX - event.clientX
      const maxWidth = getMaxInspectorWidth()
      const nextWidth = resizeStateRef.current.startWidth + deltaX
      setInspectorWidth(Math.min(maxWidth, Math.max(MIN_INSPECTOR_WIDTH, nextWidth)))
    }

    function stopResize(event?: PointerEvent) {
      if (
        event &&
        resizeStateRef.current &&
        event.pointerId !== resizeStateRef.current.pointerId
      ) {
        return
      }

      resizeStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  useEffect(() => {
    if (!contextComposer && !previewSelection && !isSettingsOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextComposer(null)
        setPreviewSelection(null)
        setSelectionError(null)
        setSelectionActionPending(null)
        setIsSettingsOpen(false)
        clearBrowserSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextComposer, isSettingsOpen, previewSelection])

  useEffect(() => {
    if (!previewSelection) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (target.closest('.selection-popover')) {
        return
      }

      if (previewBodyRef.current?.contains(target)) {
        return
      }

      setPreviewSelection(null)
      setSelectionError(null)
      setSelectionActionPending(null)
      clearBrowserSelection()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [previewSelection])

  useEffect(() => {
    setIsEdgeCustomRelation(false)
  }, [selectedEdgeId])

  useEffect(() => {
    if (!contextComposer) {
      setIsComposerCustomRelation(false)
    }
  }, [contextComposer])

  useEffect(() => {
    function handleSelectionChange() {
      window.setTimeout(() => {
        if (!selectedNode || !previewBodyRef.current) {
          return
        }

        const selection = window.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          return
        }

        const range = selection.getRangeAt(0)
        const commonAncestor = range.commonAncestorContainer
        const targetNode =
          commonAncestor.nodeType === globalThis.Node.TEXT_NODE
            ? commonAncestor.parentElement
            : (commonAncestor as Element)

        if (!targetNode || !previewBodyRef.current.contains(targetNode)) {
          return
        }

        const text = selection.toString().trim()
        if (!text) {
          return
        }

        const rect = range.getBoundingClientRect()
        const position = getSelectionPopoverPosition(rect)
        setSelectionError(null)
        setSelectionActionPending(null)
        setPreviewSelection({
          sourceNodeId: selectedNode.id,
          text,
          prompt: '',
          x: position.x,
          y: position.y,
        })
      }, 0)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [selectedNode])

  useEffect(() => {
    function handleNativeNodeContext(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      const nodeElement = target.closest<HTMLElement>('.knowledge-node[data-node-id]')
      if (!nodeElement) {
        return
      }

      const nodeId = nodeElement.dataset.nodeId
      if (!nodeId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      composerOpenGuardRef.current = Date.now()
      setSelectedNodeId(nodeId)
      setSelectedEdgeId(null)
      openContextComposer(nodeId, event.clientX, event.clientY)
    }

    document.addEventListener('contextmenu', handleNativeNodeContext, true)

    return () => {
      document.removeEventListener('contextmenu', handleNativeNodeContext, true)
    }
  }, [])

  function createNode(
    kind: NodeKind,
    sourceId?: string,
    initialData?: Partial<WorkspaceNode['data']>,
    relation?: string,
    action?: NodeAction,
  ) {
    const sourceNode = sourceId ? nodes.find((node) => node.id === sourceId) : null
    const fallbackOffset = {
      x: 80 + nodes.length * 24,
      y: 120 + nodes.length * 32,
    }
    const offset = sourceNode ? getChildOffset(kind, sourceNode) : fallbackOffset
    const node = createWorkspaceNode(kind, offset, action)
    if (initialData) {
      node.data = { ...node.data, ...initialData }
    }

    setNodes((currentNodes) => [...currentNodes, node])
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)

    if (sourceNode) {
      const edge = createWorkspaceEdge(sourceNode, node)
      if (relation) {
        edge.label = relation
        edge.data = { relation }
      }
      setEdges((currentEdges) => [...currentEdges, edge])
    }

    try {
      reactFlowRef.current?.setCenter(node.position.x, node.position.y, {
        zoom: reactFlowRef.current.getZoom(),
        duration: 400,
      })
    } catch (error) {
      console.error('Failed to recenter after node creation.', error)
    }

    return node
  }

  function updateSelectedNodeAction(action: NodeAction) {
    const nextKind = NODE_ACTION_META[action].kind
    updateSelectedNode({ action, kind: nextKind })
  }

  function openContextComposer(
    sourceNodeId: string,
    x: number,
    y: number,
    action: NodeAction = 'answer',
  ) {
    const actionMeta = NODE_ACTION_META[action]
    setComposerError(null)
    setIsComposerCustomRelation(false)
    setContextComposer({
      sourceNodeId,
      x,
      y,
      action,
      title: '',
      body: actionMeta.defaultBody,
      relation: actionMeta.defaultRelation ?? 'connects to',
    })
  }

  function updateContextComposerAction(action: NodeAction) {
    const actionMeta = NODE_ACTION_META[action]
    setContextComposer((current) =>
      current
        ? {
            ...current,
            action,
            title: current.title,
            body: actionMeta.defaultBody,
            relation: isComposerCustomRelation
              ? current.relation
              : (actionMeta.defaultRelation ?? current.relation),
          }
        : current,
    )
  }

  async function requestGeneratedChildNode({
    sourceNode,
    action,
    relation,
    draftTitle,
    draftBody,
    selectionText,
  }: {
    sourceNode: WorkspaceNode
    action: NodeAction
    relation: string
    draftTitle?: string
    draftBody?: string
    selectionText?: string
  }) {
    if (activeProvider !== 'codex') {
      throw new Error('The selected AI provider is not configured for generation yet.')
    }

    const response = await fetch('/api/codex/generate-node', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceTitle: title,
        workspaceDescription: description,
        sourceNodeTitle: sourceNode.data.title,
        sourceNodeBody: sourceNode.data.body,
        graphContext: buildGraphContext(sourceNode.id),
        action,
        draftTitle,
        draftBody,
        relation,
        selectionText,
        model,
      }),
    })

    const payload = (await response.json()) as {
      title?: string
      body?: string
      answer?: string
      error?: string
      model?: string
    }

    const fallbackFromAnswer =
      typeof payload.answer === 'string'
        ? parseGeneratedNodeAnswer(payload.answer)
        : null
    const generatedTitle =
      payload.title?.trim() ||
      fallbackFromAnswer?.title ||
      draftTitle?.trim() ||
      NODE_ACTION_META[action].defaultTitle
    const generatedBody = payload.body?.trim() || fallbackFromAnswer?.body || ''

    if (!response.ok || !generatedBody) {
      throw new Error(payload.error ?? 'Node generation failed.')
    }

    return {
      title: generatedTitle,
      body: generatedBody,
      model: payload.model,
    }
  }

  async function createNodeFromComposer() {
    if (!contextComposer) {
      return
    }

    const actionMeta = NODE_ACTION_META[contextComposer.action]
    const sourceNode = nodes.find((node) => node.id === contextComposer.sourceNodeId)
    if (!sourceNode) {
      setComposerError('Source node not found.')
      return
    }

    setComposerError(null)
    if (isCaptureOnlyAction(contextComposer.action)) {
      const captured = buildInstantCaptureNodeData({
        action: contextComposer.action,
        draftTitle: contextComposer.title,
        draftBody: contextComposer.body,
      })
      createNode(
        actionMeta.kind,
        contextComposer.sourceNodeId,
        {
          title: captured.title,
          body: captured.body,
          action: contextComposer.action,
          kind: actionMeta.kind,
        },
        contextComposer.relation,
        contextComposer.action,
      )
      setContextComposer(null)
      return
    }

    setIsComposerGenerating(true)

    try {
      const generated = await requestGeneratedChildNode({
        sourceNode,
        action: contextComposer.action,
        relation: contextComposer.relation,
        draftTitle: contextComposer.title,
        draftBody: contextComposer.body,
      })

      createNode(
        actionMeta.kind,
        contextComposer.sourceNodeId,
        {
          title: generated.title,
          body: `${generated.body}\n\n---\nGenerated with \`codex exec\`${generated.model ? ` / \`${generated.model}\`` : ''}.`,
          action: contextComposer.action,
          kind: actionMeta.kind,
        },
        contextComposer.relation,
        contextComposer.action,
      )
      setContextComposer(null)
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : 'Node generation failed.',
      )
    } finally {
      setIsComposerGenerating(false)
    }
  }

  function handlePreviewSelection() {
    window.setTimeout(() => {
      if (!selectedNode || !previewBodyRef.current) {
        return
      }

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPreviewSelection(null)
        setSelectionError(null)
        setSelectionActionPending(null)
        return
      }

      const range = selection.getRangeAt(0)
      const commonAncestor = range.commonAncestorContainer
      const targetNode =
        commonAncestor.nodeType === globalThis.Node.TEXT_NODE
          ? commonAncestor.parentElement
          : (commonAncestor as Element)

      if (!targetNode || !previewBodyRef.current.contains(targetNode)) {
        return
      }

      const text = selection.toString().trim()
      if (!text) {
        setPreviewSelection(null)
        setSelectionError(null)
        setSelectionActionPending(null)
        return
      }

      const rect = range.getBoundingClientRect()
      const position = getSelectionPopoverPosition(rect)
      setSelectionError(null)
      setSelectionActionPending(null)
      setPreviewSelection({
        sourceNodeId: selectedNode.id,
        text,
        prompt: '',
        x: position.x,
        y: position.y,
      })
    }, 0)
  }

  async function createNodeFromPreviewSelection(action: NodeAction) {
    if (!previewSelection) {
      return
    }

    const actionMeta = NODE_ACTION_META[action]
    const sourceNode = nodes.find((node) => node.id === previewSelection.sourceNodeId)
    if (!sourceNode) {
      setSelectionError('Source node not found.')
      return
    }

    setSelectionError(null)
    setSelectionActionPending(action)

    try {
      if (isCaptureOnlyAction(action)) {
        const captured = buildInstantCaptureNodeData({
          action,
          draftBody: previewSelection.prompt.trim(),
          selectionText: previewSelection.text,
        })

        createNode(
          actionMeta.kind,
          sourceNode.id,
          {
            title: captured.title,
            body: captured.body,
            action,
            kind: actionMeta.kind,
          },
          actionMeta.defaultRelation ?? 'connects to',
          action,
        )

        setPreviewSelection(null)
        setSelectionError(null)
        clearBrowserSelection()
        return
      }

      const generated = await requestGeneratedChildNode({
        sourceNode,
        action,
        relation: actionMeta.defaultRelation ?? 'connects to',
        draftBody: previewSelection.prompt.trim(),
        selectionText: previewSelection.text,
      })

      createNode(
        actionMeta.kind,
        sourceNode.id,
        {
          title: generated.title,
          body: `${generated.body}\n\n---\nGenerated from selected preview text with \`codex exec\`${generated.model ? ` / \`${generated.model}\`` : ''}.`,
          action,
          kind: actionMeta.kind,
        },
        actionMeta.defaultRelation ?? 'connects to',
        action,
      )

      setPreviewSelection(null)
      setSelectionError(null)
      clearBrowserSelection()
    } catch (error) {
      setSelectionError(
        error instanceof Error ? error.message : 'Selection generation failed.',
      )
    } finally {
      setSelectionActionPending(null)
    }
  }

  function deleteSelectedNode() {
    if (!selectedNode) {
      return
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNode.id))
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    )
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setGenerationError(null)
    setLastGeneration(null)
  }

  function deleteSelectedEdge() {
    if (!selectedEdge) {
      return
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdge.id))
    setSelectedEdgeId(null)
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 1120) {
      return
    }

    event.preventDefault()

    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: inspectorWidth,
    }
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function updateSelectedNode(patch: Partial<WorkspaceNode['data']>) {
    if (!selectedNode) {
      return
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    )
  }

  function focusNode(nodeId: string) {
    const node = nodes.find((entry) => entry.id === nodeId)
    if (!node) {
      return
    }

    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)

    try {
      reactFlowRef.current?.setCenter(node.position.x, node.position.y, {
        zoom: reactFlowRef.current.getZoom(),
        duration: 300,
      })
    } catch (error) {
      console.error('Failed to focus node.', error)
    }
  }

  function updateSelectedEdgeLabel(relation: string) {
    if (!selectedEdge) {
      return
    }

    setEdges((currentEdges) =>
      currentEdges.map((edge) =>
        edge.id === selectedEdge.id
          ? {
              ...edge,
              label: relation,
              data: { relation },
            }
          : edge,
      ),
    )
  }

  function handleConnect(connection: Connection) {
    const source = nodes.find((node) => node.id === connection.source)
    const target = nodes.find((node) => node.id === connection.target)

    if (!source || !target) {
      return
    }

    setEdges((currentEdges) =>
      addEdge(createWorkspaceEdge(source, target), currentEdges),
    )
  }

  function buildGraphContext(nodeId: string) {
    return edges
      .filter((edge) => edge.source === nodeId || edge.target === nodeId)
      .map((edge) => {
        const neighborId = edge.source === nodeId ? edge.target : edge.source
        const neighbor = nodes.find((node) => node.id === neighborId)
        return neighbor
          ? {
              relation:
                edge.source === nodeId
                  ? edge.data?.relation ?? String(edge.label ?? 'connects to')
                  : `incoming: ${edge.data?.relation ?? String(edge.label ?? 'connects to')}`,
              kind: neighbor.data.kind,
              title: neighbor.data.title,
              body: clipText(neighbor.data.body, 240),
            }
          : null
      })
      .filter((entry) => entry !== null)
  }

  async function generateAnswerNode() {
    if (!selectedNode) {
      return
    }

    if (activeProvider !== 'codex') {
      setGenerationError('The selected AI provider is not configured for generation yet.')
      return
    }

    setGenerationError(null)
    setLastGeneration(null)
    setIsGenerating(true)

    try {
      const response = await fetch('/api/codex/generate-answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceTitle: title,
          workspaceDescription: description,
          nodeTitle: selectedNode.data.title,
          nodeBody: selectedNode.data.body,
          graphContext: buildGraphContext(selectedNode.id),
          model,
        }),
      })

      const payload = (await response.json()) as {
        answer?: string
        error?: string
        model?: string
      }

      if (!response.ok || !payload.answer) {
        throw new Error(payload.error ?? 'AI generation failed.')
      }

      createNode(
        'answer',
        selectedNode.id,
        {
          title: `AI answer: ${clipText(selectedNode.data.title, 48)}`,
          body: `${payload.answer.trim()}\n\n---\nGenerated with \`codex exec\`${payload.model ? ` / \`${payload.model}\`` : ''}.`,
          action: 'answer',
          kind: 'answer',
        },
        'answered by',
        'answer',
      )
      setLastGeneration(
        payload.model ? `Generated with codex exec / ${payload.model}` : 'Generated with codex exec',
      )
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Generation failed.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  async function importWorkspace(file: File) {
    const text = await file.text()
    const doc = deserializeWorkspace(text)
    startTransition(() => {
      applyWorkspace(doc)
      saveToBrowser(doc.viewport)
    })
  }

  function resetWorkspace() {
    const fresh = emptyWorkspace()
    applyWorkspace(fresh)
    saveToBrowser(fresh.viewport)
  }

  function saveMarkdownFile() {
    const doc = snapshotDocument(reactFlowRef.current?.getViewport() ?? viewport)
    downloadText(
      `${doc.title.toLowerCase().replaceAll(/\s+/g, '-') || 'vibe-mind-workspace'}.md`,
      serializeWorkspace(doc),
    )
  }

  const renderNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onOpenComposer: (event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        setSelectedNodeId(node.id)
        setSelectedEdgeId(null)
        openContextComposer(node.id, event.clientX, event.clientY)
      },
    },
  }))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__identity">
          <div className="topbar__badge">Vibe Mind</div>
          <div>
            <h1>Start from the graph</h1>
              <p>
                Map questions, answers, key ideas, and next steps in one connected workspace.
              </p>
          </div>
        </div>

        <div className="topbar__actions">
          <button className="button--ghost" onClick={() => setIsSettingsOpen(true)}>
            Settings
          </button>
          <button className="button--ghost" onClick={resetWorkspace}>
            Reset
          </button>
          <button onClick={() => fileInputRef.current?.click()}>Open .md</button>
          <button className="button--accent" onClick={saveMarkdownFile}>
            Save .md
          </button>
        </div>
      </header>

      <div className="workspace-meta">
        <label>
          <span>Workspace title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Agent Lightning exploration"
          />
        </label>
        <label>
          <span>Context</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Why this workspace exists"
          />
        </label>
      </div>

      <main
        className={`layout ${isResizing ? 'layout--resizing' : ''}`}
        style={
          isStackedLayout
            ? undefined
            : { gridTemplateColumns: `minmax(0, 1fr) 14px ${inspectorWidth}px` }
        }
      >
        <section className="canvas-panel">
          <div className="canvas-panel__toolbar">
            <span className="canvas-panel__hint">
              Right-click a node to branch the graph, or drag text in Preview to spawn an answer, todo, important note, or any other focused child node.
            </span>
          </div>

          <div
            className="canvas-panel__flow"
            onContextMenu={(event) => event.preventDefault()}
          >
            <ReactFlow<WorkspaceNode, WorkspaceEdge>
              defaultViewport={viewport}
              edges={edges}
              fitView
              minZoom={0.2}
              nodeTypes={nodeTypes}
              nodes={renderNodes}
              onConnect={handleConnect}
              onEdgesChange={onEdgesChange}
              onInit={(instance) => {
                reactFlowRef.current = instance
                instance.setViewport(viewport, { duration: 0 })
              }}
              onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
              onNodesChange={onNodesChange}
              onPaneClick={() => {
                if (contextComposer) {
                  return
                }
                if (Date.now() - composerOpenGuardRef.current < 200) {
                  return
                }
                setContextComposer(null)
                setPreviewSelection(null)
                setSelectionError(null)
                setSelectionActionPending(null)
                clearBrowserSelection()
              }}
              onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
                setSelectedNodeId(selectedNodes[0]?.id ?? null)
                setSelectedEdgeId(selectedEdges[0]?.id ?? null)
                if (contextComposer) {
                  return
                }
                if (Date.now() - composerOpenGuardRef.current < 200) {
                  return
                }
                if (selectedNodes.length === 0 && selectedEdges.length === 0) {
                  setContextComposer(null)
                  setPreviewSelection(null)
                  setSelectionError(null)
                  setSelectionActionPending(null)
                  clearBrowserSelection()
                }
              }}
              proOptions={{ hideAttribution: true }}
            >
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  NODE_KIND_META[(node.data?.kind as NodeKind) ?? 'concept'].miniMapColor
                }
              />
              <Controls showInteractive={false} />
              <Background color="#d0d5dd" gap={28} variant={BackgroundVariant.Dots} />
            </ReactFlow>

            <div className="floating-panels">
              <section className="floating-panel floating-panel--todo">
                <div className="floating-panel__header">
                  <h3>TODO</h3>
                  <span>{todoNodes.length}</span>
                </div>
                {todoNodes.length ? (
                  <div className="floating-panel__list">
                    {todoNodes.map((node) => (
                      <button
                        key={node.id}
                        className={`floating-panel__item ${
                          selectedNodeId === node.id ? 'floating-panel__item--active' : ''
                        }`}
                        onClick={() => focusNode(node.id)}
                        type="button"
                      >
                        <strong>{node.data.title}</strong>
                        <span>{clipText(node.data.body, 96)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="floating-panel__empty">No todo items yet.</p>
                )}
              </section>

              <section className="floating-panel floating-panel--important">
                <div className="floating-panel__header">
                  <h3>Important</h3>
                  <span>{importantNodes.length}</span>
                </div>
                {importantNodes.length ? (
                  <div className="floating-panel__list">
                    {importantNodes.map((node) => (
                      <button
                        key={node.id}
                        className={`floating-panel__item ${
                          selectedNodeId === node.id ? 'floating-panel__item--active' : ''
                        }`}
                        onClick={() => focusNode(node.id)}
                        type="button"
                      >
                        <strong>{node.data.title}</strong>
                        <span>{clipText(node.data.body, 96)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="floating-panel__empty">No important notes yet.</p>
                )}
              </section>
            </div>
          </div>
        </section>

        <div
          aria-hidden="true"
          className="layout__resizer"
          onPointerDown={startResize}
          role="separator"
          title="Resize inspector"
        />

        <aside className="inspector">
          {selectedNode ? (
            <div className="inspector__section">
              <div className="inspector__heading">
                <span
                  className="inspector__kind-dot"
                  style={{ background: NODE_KIND_META[selectedNode.data.kind].miniMapColor }}
                />
                <div>
                  <h2>{NODE_KIND_META[selectedNode.data.kind].label}</h2>
                  <p>{selectedNode.id}</p>
                </div>
              </div>

              <div className="ai-panel">
                <div className="ai-panel__header">
                  <div>
                    <h3>AI generation</h3>
                    <p>Use the selected provider to create a connected answer node.</p>
                  </div>
                  <span
                    className={`ai-pill ${
                      activeProviderStatus?.ready ? 'ai-pill--ok' : 'ai-pill--warn'
                    }`}
                  >
                    {activeProviderStatus?.ready
                      ? activeProvider === 'codex'
                        ? 'Codex ready'
                        : `${activeProvider} ready`
                      : `${activeProvider} unavailable`}
                  </span>
                </div>

                <div className="ai-panel__meta">
                  <span>
                    Provider: <strong>{activeProvider === 'codex' ? 'Codex via ChatGPT plan' : 'Claude CLI'}</strong>
                  </span>
                  <span>
                    Model: <strong>{effectiveModel || 'CLI default'}</strong>
                  </span>
                  {activeProviderStatus?.reasoningEffort ? (
                    <span>
                      Reasoning: <strong>{activeProviderStatus.reasoningEffort}</strong>
                    </span>
                  ) : null}
                </div>

                <label>
                  <span>Model override</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Leave blank to use the selected provider default model"
                  />
                </label>

                <div className="ai-panel__footer">
                  <div className="ai-panel__message">
                    {generationError ? (
                      <span className="ai-panel__error">{generationError}</span>
                    ) : lastGeneration ? (
                      <span className="ai-panel__success">{lastGeneration}</span>
                    ) : (
                      <span>{activeProviderStatus?.displayStatus ?? activeProviderStatus?.statusText ?? 'Checking AI provider status...'}</span>
                    )}
                  </div>
                  <button
                    className="button--accent"
                    disabled={isGenerating || !activeProviderStatus?.ready}
                    onClick={() => void generateAnswerNode()}
                  >
                    {isGenerating ? 'Generating…' : 'Generate answer node'}
                  </button>
                </div>
              </div>

              <div className="connections-panel">
                <div className="connections-panel__header">
                  <h3>Connections</h3>
                  <span>{selectedNodeConnections.length}</span>
                </div>
                {selectedNodeConnections.length ? (
                  <div className="connections-list">
                    {selectedNodeConnections.map((connection) => (
                      <div key={connection.id} className="connection-chip">
                        <span className="connection-chip__direction">
                          {connection.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
                        </span>
                        <strong>{connection.relation}</strong>
                        <span>
                          {NODE_KIND_META[connection.peerKind].label}: {connection.peerTitle}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="connections-panel__empty">No connected nodes yet.</p>
                )}
              </div>

              <button className="button--danger" onClick={deleteSelectedNode}>
                Delete this node
              </button>

              <label>
                <span>Node type</span>
                <select
                  value={selectedNodeAction ?? inferActionFromKind(selectedNode.data.kind)}
                  onChange={(event) =>
                    updateSelectedNodeAction(event.target.value as NodeAction)
                  }
                >
                  {Object.entries(NODE_KIND_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Title</span>
                <input
                  value={selectedNode.data.title}
                  onChange={(event) => updateSelectedNode({ title: event.target.value })}
                />
              </label>

              <label className="inspector__editor">
                <span>Markdown body</span>
                <textarea
                  value={selectedNode.data.body}
                  onChange={(event) => updateSelectedNode({ body: event.target.value })}
                  placeholder="Write the explanation, notes, examples, citations, or unresolved questions here."
                />
              </label>

              <div className="preview">
                <div className="preview__title">Preview</div>
                <div
                  ref={previewBodyRef}
                  className="preview__body"
                  onMouseUp={handlePreviewSelection}
                  onKeyUp={handlePreviewSelection}
                >
                  <ReactMarkdown>{selectedNode.data.body || '*Empty node*'}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : selectedEdge ? (
            <div className="inspector__section">
              <div className="inspector__heading">
                <div>
                  <h2>Relation</h2>
                  <p>
                    {selectedEdge.source} -&gt; {selectedEdge.target}
                  </p>
                </div>
              </div>

              <label>
                <span>Suggested relation</span>
                <select
                  value={selectedEdgeRelationValue}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === CUSTOM_RELATION_VALUE) {
                      setIsEdgeCustomRelation(true)
                      return
                    }
                    setIsEdgeCustomRelation(false)
                    updateSelectedEdgeLabel(value)
                  }}
                >
                  {selectedEdgeRelationOptions.map((relation) => (
                    <option key={relation} value={relation}>
                      {relation}
                    </option>
                  ))}
                  <option value={CUSTOM_RELATION_VALUE}>Custom relation…</option>
                </select>
              </label>
              <details
                className="advanced-input"
                open={
                  isEdgeCustomRelation ||
                  selectedEdgeRelationValue === CUSTOM_RELATION_VALUE
                }
              >
                <summary>Custom relation</summary>
                <label>
                  <span>Relation text</span>
                  <input
                    value={selectedEdge.data?.relation ?? ''}
                    onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                    placeholder="supports / depends on / compares with"
                  />
                </label>
              </details>
              <button className="button--danger" onClick={deleteSelectedEdge}>
                Delete this edge
              </button>
            </div>
          ) : (
            <div className="inspector__empty">
              <h2>Graph-first, not note-first</h2>
              <p>
                Start from a question node, branch into answers, concepts, research, todos, and key notes, and
                keep the structure visible while the detailed text stays one click away.
              </p>
              <ol>
                <li>Create a `question` node for the thing you want to learn.</li>
                <li>Right-click a node to branch into answers, concepts, new questions, research threads, todo items, or important notes.</li>
                <li>Drag text in Preview to spawn a node focused on that exact excerpt.</li>
              </ol>
            </div>
          )}
        </aside>
      </main>

      <input
        ref={fileInputRef}
        accept=".md,text/markdown"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void importWorkspace(file)
          }
          event.target.value = ''
        }}
        type="file"
      />

      {isSettingsOpen ? (
        <div
          className="settings-modal__backdrop"
          onMouseDown={() => setIsSettingsOpen(false)}
        >
          <div
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-modal__header">
              <div>
                <h3>AI settings</h3>
                <p>Choose which subscribed assistant should generate questions, answers, concepts, research nodes, todos, and important notes.</p>
              </div>
              <button className="button--ghost" onClick={() => setIsSettingsOpen(false)}>
                Close
              </button>
            </div>

            <div className="settings-modal__providers">
              {([
                ['codex', codexStatus, 'ChatGPT / Codex CLI'],
                ['claude', claudeStatus, 'Claude CLI'],
              ] as const).map(([provider, status, label]) => (
                <label
                  key={provider}
                  className={`provider-card ${
                    activeProvider === provider ? 'provider-card--active' : ''
                  } ${status?.ready ? '' : 'provider-card--disabled'}`}
                >
                  <div className="provider-card__row">
                    <div>
                      <strong>{label}</strong>
                      <p>{status?.displayStatus ?? status?.statusText ?? 'Checking status...'}</p>
                      <p>
                        Model: <strong>{status?.defaultModel || 'CLI default'}</strong>
                        {status?.reasoningEffort ? ` / ${status.reasoningEffort}` : ''}
                      </p>
                    </div>
                    <input
                      checked={activeProvider === provider}
                      disabled={!status?.ready}
                      name="provider"
                      onChange={() => setActiveProvider(provider)}
                      type="radio"
                    />
                  </div>
                </label>
              ))}
            </div>

            <div className="settings-modal__footer">
              <span>
                Current provider: <strong>{activeProvider}</strong>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {previewSelection ? (
        <div
          className="selection-popover"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            left: previewSelection.x,
            top: previewSelection.y,
          }}
        >
          <div className="selection-popover__header">
            <strong>Selected text</strong>
            <button
              className="button--ghost"
              onClick={() => {
                setPreviewSelection(null)
                setSelectionError(null)
                setSelectionActionPending(null)
                clearBrowserSelection()
              }}
            >
              Close
            </button>
          </div>
          <blockquote className="selection-popover__quote">
            {clipText(previewSelection.text, 220)}
          </blockquote>
          <label className="selection-popover__editor">
            <span>Extra prompt</span>
            <textarea
              value={previewSelection.prompt}
              onChange={(event) =>
                setPreviewSelection((current) =>
                  current ? { ...current, prompt: event.target.value } : current,
                )
              }
              placeholder="Add a constraint, angle, or question for the generated node."
            />
          </label>
          <div className="selection-popover__actions">
            {(['answer', 'question', 'concept', 'research', 'todo', 'important'] as NodeAction[]).map((action) => (
              <button
                key={action}
                className={action === 'answer' ? 'button--accent' : 'button--ghost'}
                disabled={
                  selectionActionPending !== null ||
                  (!isCaptureOnlyAction(action) && !activeProviderStatus?.ready)
                }
                onClick={() => void createNodeFromPreviewSelection(action)}
              >
                {selectionActionPending === action
                  ? isCaptureOnlyAction(action)
                    ? 'Saving…'
                    : 'Generating…'
                  : NODE_ACTION_META[action].label}
              </button>
            ))}
          </div>
          {selectionError ? (
            <div className="selection-popover__error">{selectionError}</div>
          ) : (
            <div className="selection-popover__hint">
              The selected provider will focus the next node on the selected excerpt.
            </div>
          )}
        </div>
      ) : null}

      {contextComposer ? (
        <div
          className="context-composer__backdrop"
          onContextMenu={(event) => event.preventDefault()}
          onMouseDown={() => setContextComposer(null)}
        >
          <div
            className="context-composer"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              left: Math.min(contextComposer.x, window.innerWidth - 420),
              top: Math.min(contextComposer.y, window.innerHeight - 760),
            }}
          >
            <div className="context-composer__header">
              <div>
                <h3>Node action</h3>
                <p>Choose the child node type, add hints, and let the selected provider generate the title and body.</p>
              </div>
              <button className="button--ghost" onClick={() => setContextComposer(null)}>
                Close
              </button>
            </div>

            <label>
              <span>Node type</span>
              <select
                value={contextComposer.action}
                onChange={(event) =>
                  updateContextComposerAction(event.target.value as NodeAction)
                }
              >
                {Object.entries(NODE_ACTION_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Suggested relation</span>
              <select
                value={
                  composerRelationOptions.includes(contextComposer.relation)
                    ? contextComposer.relation
                    : CUSTOM_RELATION_VALUE
                }
                onChange={(event) => {
                  const value = event.target.value
                  if (value === CUSTOM_RELATION_VALUE) {
                    setIsComposerCustomRelation(true)
                    return
                  }
                  setIsComposerCustomRelation(false)
                  setContextComposer((current) =>
                    current ? { ...current, relation: value } : current,
                  )
                }}
              >
                {composerRelationOptions.map((relation) => (
                  <option key={relation} value={relation}>
                    {relation}
                  </option>
                ))}
                <option value={CUSTOM_RELATION_VALUE}>Custom relation…</option>
              </select>
            </label>
            <details
              className="advanced-input"
              open={
                isComposerCustomRelation ||
                !composerRelationOptions.includes(contextComposer.relation)
              }
            >
              <summary>Custom relation</summary>
              <label>
                <span>Relation text</span>
                <input
                  value={contextComposer.relation}
                  onChange={(event) =>
                    setContextComposer((current) =>
                      current ? { ...current, relation: event.target.value } : current,
                    )
                  }
                  placeholder="supports / depends on / compares with"
                />
              </label>
            </details>

            <label>
              <span>Title hint</span>
              <input
                value={contextComposer.title}
                onChange={(event) =>
                  setContextComposer((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                placeholder={`${NODE_ACTION_META[contextComposer.action].defaultTitle} (optional)`}
              />
            </label>

            <label className="inspector__editor">
              <span>Markdown body</span>
              <textarea
                value={contextComposer.body}
                onChange={(event) =>
                  setContextComposer((current) =>
                    current ? { ...current, body: event.target.value } : current,
                  )
                }
              />
            </label>

            {composerError ? (
              <div className="context-composer__error">{composerError}</div>
            ) : (
              <div className="context-composer__hint">
                {isCaptureOnlyAction(contextComposer.action)
                  ? 'Todo and important nodes are captured directly from the text and notes above.'
                  : 'The selected provider will use the action, optional title hint, and body notes above to generate both the node title and markdown body.'}
              </div>
            )}

            <div className="context-composer__actions">
              <button className="button--ghost" onClick={() => setContextComposer(null)}>
                Cancel
              </button>
              <button
                className="button--accent"
                disabled={
                  isComposerGenerating ||
                  (!isCaptureOnlyAction(contextComposer.action) &&
                    !activeProviderStatus?.ready)
                }
                onClick={() => void createNodeFromComposer()}
              >
                {isComposerGenerating
                  ? 'Generating…'
                  : isCaptureOnlyAction(contextComposer.action)
                    ? 'Save node'
                    : 'Generate node'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  )
}

export default App
