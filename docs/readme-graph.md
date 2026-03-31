# LLM systems map

Example workspace for the README capture.

```vibemind-graph
{
  "version": 1,
  "viewport": { "x": -40, "y": 10, "zoom": 0.78 },
  "nodes": [
    { "id": "root-question", "position": { "x": 40, "y": 200 } },
    { "id": "answer-node", "position": { "x": 360, "y": 160 } },
    { "id": "concept-node", "position": { "x": 710, "y": 50 } },
    { "id": "research-node", "position": { "x": 720, "y": 290 } },
    { "id": "question-node", "position": { "x": 360, "y": 360 } },
    { "id": "todo-node", "position": { "x": 1040, "y": 250 } },
    { "id": "important-node", "position": { "x": 1040, "y": 70 } }
  ],
  "edges": [
    { "id": "edge-1", "source": "root-question", "target": "answer-node", "relation": "answered by" },
    { "id": "edge-2", "source": "answer-node", "target": "concept-node", "relation": "uses" },
    { "id": "edge-3", "source": "root-question", "target": "question-node", "relation": "raises" },
    { "id": "edge-4", "source": "question-node", "target": "research-node", "relation": "requires evidence" },
    { "id": "edge-5", "source": "research-node", "target": "todo-node", "relation": "tracks" },
    { "id": "edge-6", "source": "answer-node", "target": "important-node", "relation": "highlights" }
  ]
}
```

## Node: root-question
```vibemind-node-meta
{
  "title": "What is actually new in agentic RL tooling?",
  "kind": "question",
  "action": "question"
}
```
I want a practical map of what changes when agent systems become trainable.

- which part is infrastructure
- which part is learning algorithm
- which pieces still need verification

---

## Node: answer-node
```vibemind-node-meta
{
  "title": "Execution and training get separated",
  "kind": "answer",
  "action": "answer"
}
```
The strongest pattern is the separation between agent execution and model optimization.

That makes tracing, evaluation, and RL updates easier to plug into existing agent workflows.

---

## Node: concept-node
```vibemind-node-meta
{
  "title": "Credit assignment",
  "kind": "concept",
  "action": "concept"
}
```
Credit assignment is the step that decides which part of a long trajectory deserves reward or blame.

In graph terms, it explains why a later answer can still depend on earlier actions.

---

## Node: research-node
```vibemind-node-meta
{
  "title": "What evidence separates infra from novelty?",
  "kind": "research",
  "action": "research"
}
```
Check the strongest benchmark and ablation evidence first.

- compare framework claims against actual learning gains
- isolate what changes with and without the trace layer
- note where the paper is still mostly architectural

---

## Node: question-node
```vibemind-node-meta
{
  "title": "What should be validated next?",
  "kind": "question",
  "action": "question"
}
```
The next useful question is not just whether the system works, but what kind of improvement it really delivers.

---

## Node: todo-node
```vibemind-node-meta
{
  "title": "Pull the ablation table",
  "kind": "todo",
  "action": "todo"
}
```
Extract the benchmark and ablation rows that separate orchestration gains from actual policy improvement.

---

## Node: important-node
```vibemind-node-meta
{
  "title": "The graph is the product surface",
  "kind": "important",
  "action": "important"
}
```
The main UX idea is that structure stays visible all the time, instead of being buried in linear notes.
