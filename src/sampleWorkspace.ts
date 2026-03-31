import { createWorkspaceEdge, type WorkspaceDocument, type WorkspaceNode } from './lib/workspace'

const agentLightning: WorkspaceNode = {
  id: 'agent-lightning-question',
  type: 'knowledge',
  position: { x: 40, y: 120 },
  data: {
    action: 'question',
    kind: 'question',
    title: 'What is Agent Lightning?',
    body:
      'I want a practical understanding of Agent Lightning.\n\nQuestions:\n- What does it actually add beyond standard RL for LLMs?\n- Is it mainly an algorithm, or a middleware layer?\n- Where does GRPO or PPO fit?',
  },
}

const summary: WorkspaceNode = {
  id: 'agent-lightning-answer',
  type: 'knowledge',
  position: { x: 360, y: 80 },
  data: {
    action: 'answer',
    kind: 'answer',
    title: 'Short answer',
    body:
      'Agent Lightning is mostly a framework for turning agent traces into RL training data.\n\nThe practical value is that it decouples agent execution from training infrastructure and keeps the graph of multi-step behavior visible.',
  },
}

const grpo: WorkspaceNode = {
  id: 'grpo-concept',
  type: 'knowledge',
  position: { x: 700, y: 32 },
  data: {
    action: 'concept',
    kind: 'concept',
    title: 'GRPO',
    body:
      'Group Relative Policy Optimization compares multiple outputs for the same task and reinforces the better ones.\n\nIn Agent Lightning, per-step transitions can still be fed into existing RL algorithms like GRPO.',
  },
}

const ppo: WorkspaceNode = {
  id: 'ppo-concept',
  type: 'knowledge',
  position: { x: 700, y: 220 },
  data: {
    action: 'concept',
    kind: 'concept',
    title: 'PPO',
    body:
      'Proximal Policy Optimization is a common policy-gradient RL algorithm.\n\nAgent Lightning claims compatibility with standard single-step RL recipes once multi-step trajectories are decomposed.',
  },
}

const nextQuestion: WorkspaceNode = {
  id: 'next-question',
  type: 'knowledge',
  position: { x: 340, y: 280 },
  data: {
    action: 'question',
    kind: 'question',
    title: 'What is actually new here?',
    body:
      'Potential answer candidates:\n- the trace abstraction\n- the credit assignment layer\n- the training-agent disaggregation architecture\n\nThis is the next question that should sharpen the rest of the graph.',
  },
}

const benchmarkResearch: WorkspaceNode = {
  id: 'benchmark-research',
  type: 'knowledge',
  position: { x: 690, y: 280 },
  data: {
    action: 'research',
    kind: 'research',
    title: 'What evidence should we check?',
    body:
      'Look for benchmark comparisons, ablations, and failure cases.\n\nThis node tracks what evidence would confirm whether Agent Lightning is mostly infrastructure, mostly algorithmic, or both.',
  },
}

const implementationTodo: WorkspaceNode = {
  id: 'implementation-todo',
  type: 'knowledge',
  position: { x: 1010, y: 200 },
  data: {
    action: 'todo',
    kind: 'todo',
    title: 'Check benchmark tables',
    body:
      'Pull the benchmark and ablation tables from the paper.\n\nWe need direct evidence before deciding whether the contribution is mostly infrastructure or algorithmic.',
  },
}

const keyTakeaway: WorkspaceNode = {
  id: 'key-takeaway',
  type: 'knowledge',
  position: { x: 1010, y: 40 },
  data: {
    action: 'important',
    kind: 'important',
    title: 'Training is the real novelty',
    body:
      'The strongest practical point is the decoupling between agent execution and RL training.\n\nThat framing should anchor the rest of the map.',
  },
}

export const sampleWorkspace: WorkspaceDocument = {
  title: 'Agent Lightning map',
  description:
    'Example workspace showing how a question can branch into answers, concepts, research nodes, todo items, important notes, and more questions.',
  nodes: [
    agentLightning,
    summary,
    grpo,
    ppo,
    nextQuestion,
    benchmarkResearch,
    implementationTodo,
    keyTakeaway,
  ],
  edges: [
    createWorkspaceEdge(agentLightning, summary),
    createWorkspaceEdge(summary, grpo),
    createWorkspaceEdge(summary, ppo),
    createWorkspaceEdge(agentLightning, nextQuestion),
    createWorkspaceEdge(nextQuestion, benchmarkResearch),
    createWorkspaceEdge(benchmarkResearch, implementationTodo),
    createWorkspaceEdge(summary, keyTakeaway),
  ],
  viewport: { x: 0, y: 0, zoom: 0.72 },
}
