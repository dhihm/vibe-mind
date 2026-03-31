import express from 'express'
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT ?? 8787)
const host = '127.0.0.1'

const app = express()
app.use(express.json({ limit: '1mb' }))

async function readCodexConfig() {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml')
    const content = await fs.readFile(configPath, 'utf8')
    const model = content.match(/^model\s*=\s*"(.+)"$/m)?.[1] ?? ''
    const reasoningEffort =
      content.match(/^model_reasoning_effort\s*=\s*"(.+)"$/m)?.[1] ?? ''

    return { model, reasoningEffort }
  } catch {
    return { model: '', reasoningEffort: '' }
  }
}

async function getCodexLoginStatus() {
  try {
    const { stdout, stderr } = await execFileAsync('codex', ['login', 'status'], {
      cwd: rootDir,
    })
    const statusText = `${stdout}\n${stderr}`.trim()
    const config = await readCodexConfig()
    const authSource = statusText.includes('ChatGPT') ? 'ChatGPT plan' : 'Codex login'
    return {
      available: true,
      loggedIn: statusText.includes('Logged in'),
      statusText,
      authSource,
      displayStatus: statusText.includes('Logged in')
        ? `Codex CLI authenticated via ${authSource}`
        : statusText,
      defaultModel: process.env.CODEX_MODEL || config.model || '',
      reasoningEffort: config.reasoningEffort,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to query Codex login status.'
    return {
      available: false,
      loggedIn: false,
      statusText: message,
      authSource: '',
      displayStatus: message,
      defaultModel: process.env.CODEX_MODEL || '',
      reasoningEffort: '',
    }
  }
}

async function getClaudeStatus() {
  try {
    const { stdout } = await execFileAsync('bash', ['-lc', 'command -v claude'], {
      cwd: rootDir,
      timeout: 4000,
    })
    const claudePath = stdout.trim()

    if (!claudePath) {
      return {
        available: false,
        ready: false,
        statusText: 'Claude CLI was not found on this machine.',
        displayStatus: 'Claude CLI was not found on this machine.',
        defaultModel: process.env.CLAUDE_MODEL || '',
        reasoningEffort: '',
      }
    }

    const script = await fs.readFile(claudePath, 'utf8').catch(() => '')
    if (script.includes('mock-claude')) {
      return {
        available: true,
        ready: false,
        statusText: 'A mock Claude CLI was detected. Claude generation is not configured on this machine.',
        displayStatus: 'A mock Claude CLI was detected. Claude generation is not configured on this machine.',
        defaultModel: process.env.CLAUDE_MODEL || '',
        reasoningEffort: '',
      }
    }

    return {
      available: true,
      ready: false,
      statusText: 'Claude CLI was detected, but generation is not configured yet.',
      displayStatus: 'Claude CLI was detected, but generation is not configured yet.',
      defaultModel: process.env.CLAUDE_MODEL || '',
      reasoningEffort: '',
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        available: false,
        ready: false,
        statusText: 'Claude CLI was not found on this machine.',
        displayStatus: 'Claude CLI was not found on this machine.',
        defaultModel: process.env.CLAUDE_MODEL || '',
        reasoningEffort: '',
      }
    }

    return {
      available: false,
      ready: false,
      statusText: 'Claude CLI status could not be determined on this machine.',
      displayStatus: 'Claude CLI status could not be determined on this machine.',
      defaultModel: process.env.CLAUDE_MODEL || '',
      reasoningEffort: '',
    }
  }
}

function buildAnswerPrompt({
  workspaceTitle,
  workspaceDescription,
  nodeTitle,
  nodeBody,
  graphContext,
}) {
  return [
    'You are generating the body for a graph node in a graph-first knowledge workspace.',
    'Return markdown only. Do not wrap the answer in code fences.',
    'Be concise, concrete, and useful.',
    'Write the final explanation, not your working notes.',
    'Do not narrate your reasoning process, extraction plan, or what you would do next.',
    'Do not use section headings like "Short answer" or "Why it matters" unless the user explicitly asked for that format.',
    '',
    `Workspace title: ${workspaceTitle || 'Untitled workspace'}`,
    `Workspace context: ${workspaceDescription || 'No extra context provided.'}`,
    '',
    `Selected node title: ${nodeTitle}`,
    'Selected node body:',
    nodeBody || 'No body content provided.',
    '',
    'Connected graph context:',
    graphContext?.length
      ? graphContext
          .map(
            (entry, index) =>
              `${index + 1}. [${entry.relation}] ${entry.kind}: ${entry.title}${
                entry.body ? `\n${entry.body}` : ''
              }`,
          )
          .join('\n\n')
      : 'No connected nodes yet.',
    '',
    'Write the content for a new answer node that directly helps the user understand the selected node.',
    'If the source text sounds like a research task or note-taking instruction, convert it into a direct explanation rather than repeating the task.',
  ].join('\n')
}

function getNodeActionPrompt(action, selectionText, draftBody) {
  const focusLine = selectionText
    ? 'Start from the selected excerpt. Explain or expand that excerpt before widening out to the parent node.'
    : 'Start from the parent node as a whole.'
  const extraInstructionLine = draftBody
    ? `User instruction to honor: ${draftBody}`
    : 'No extra user instruction was provided.'

  if (action === 'answer') {
    return [
      'You are writing an answer node.',
      focusLine,
      extraInstructionLine,
      'The node should directly resolve confusion, not just restate the source.',
      'Prefer concrete explanation over vague overview.',
      'Write the answer itself, not a study plan or extraction checklist.',
      'If the selected text is phrased as a task, rewrite it into the actual explanation the user needs.',
      'Avoid headings like "Short answer", "Why it matters", or "What to inspect next" unless the user explicitly asked for them.',
      'Avoid filler, throat-clearing, and generic study-note language.',
    ]
  }

  if (action === 'question') {
    return [
      'You are writing a question node.',
      focusLine,
      extraInstructionLine,
      'The title should be a sharp question, not a topic label.',
      'The body should explain why this question matters now and what answering it would unlock.',
      'Do not answer the question fully. Frame the uncertainty or next line of inquiry.',
      'Do not drift into generic summary. Stay specific to the next question.',
    ]
  }

  if (action === 'concept') {
    return [
      'You are writing a concept node.',
      focusLine,
      extraInstructionLine,
      'The node should define the concept clearly, then tie it back to the parent node.',
      'Write the concept explanation itself, not a plan for reading the paper or collecting evidence.',
      'Lead with a direct definition or explanation in plain language.',
      'Then connect it back to why this concept matters in the current graph.',
      'Do not write a generic encyclopedia entry. Keep it tied to this graph.',
    ]
  }

  if (action === 'todo') {
    return [
      'You are writing a todo node.',
      focusLine,
      extraInstructionLine,
      'The node should capture a concrete next step, not a broad project plan.',
      'Make the title action-oriented and easy to scan later.',
      'The body should state what needs to happen and why it matters now.',
      'Keep it concise. One short paragraph and at most a few bullets if necessary.',
      'Do not drift into full explanation mode. This is an actionable follow-up item.',
    ]
  }

  if (action === 'important') {
    return [
      'You are writing an important-note node.',
      focusLine,
      extraInstructionLine,
      'The node should capture the key takeaway, warning, or constraint the user should not forget.',
      'Make the title compact and high-signal.',
      'The body should explain why this point matters in the current graph.',
      'Keep it concise and memorable.',
      'Do not turn it into a general summary of the whole topic.',
    ]
  }

  return [
    'You are writing a research node.',
    focusLine,
    extraInstructionLine,
    'The node should be a focused verification note, not a generic research plan.',
    'Anchor it to a specific claim, uncertainty, or comparison in the source node.',
    'Do not spend the first paragraph re-explaining the whole concept unless a one-line framing sentence is needed.',
    'Identify the exact claim under test, what is still uncertain, the strongest evidence to seek, and what result would change the parent node.',
    'Prefer one short framing paragraph plus 3 to 5 tight bullets when bullets help.',
    'Avoid boilerplate headings like "Research question", "Evidence to gather", or "Useful sources or experiments" unless the user explicitly asked for that template.',
    'Do not list every possible source. Choose the highest-signal checks only.',
  ]
}

function buildNodePrompt({
  workspaceTitle,
  workspaceDescription,
  sourceNodeTitle,
  sourceNodeBody,
  graphContext,
  action,
  draftTitle,
  draftBody,
  relation,
  selectionText,
}) {
  const actionSpecificGuidance = getNodeActionPrompt(action, selectionText, draftBody)

  return [
    'You are generating a title and markdown body for a new child node in a graph-first knowledge workspace.',
    'Your output must reflect the requested action strongly. Do not collapse everything into a generic summary.',
    'Return exactly this format:',
    'TITLE: <short node title>',
    'BODY:',
    '<markdown body>',
    'Do not wrap the response in code fences.',
    'Think silently. Output only the final TITLE/BODY payload.',
    '',
    `Workspace title: ${workspaceTitle || 'Untitled workspace'}`,
    `Workspace context: ${workspaceDescription || 'No extra context provided.'}`,
    '',
    `Source node title: ${sourceNodeTitle}`,
    'Source node body:',
    sourceNodeBody || 'No body content provided.',
    '',
    `Requested child action: ${action}`,
    `Requested relation: ${relation || 'connects to'}`,
    `Optional title hint from user: ${draftTitle || 'No title hint provided.'}`,
    'Selected excerpt from preview:',
    selectionText || 'No specific excerpt selected.',
    '',
    'Connected graph context:',
    graphContext?.length
      ? graphContext
          .map(
            (entry, index) =>
              `${index + 1}. [${entry.relation}] ${entry.kind}: ${entry.title}${
                entry.body ? `\n${entry.body}` : ''
              }`,
          )
          .join('\n\n')
      : 'No connected nodes yet.',
    '',
    'Action-specific guidance:',
    ...actionSpecificGuidance,
    '',
    'Global style rules:',
    '- Never output hidden reasoning, thinking traces, or self-instructions.',
    '- Never say you will extract, inspect, compare, or gather evidence unless the action is research.',
    '- For answer and concept nodes, write final explanatory content rather than a workflow.',
    '- For question nodes, write a real question plus a short explanation of why it matters.',
    '- For research nodes, write a targeted verification note rather than a broad checklist.',
    '- For todo nodes, write a concrete next step.',
    '- For important nodes, write a compact key takeaway or warning.',
    '- If the source excerpt is itself procedural, translate it into the underlying explanation.',
    '',
    'Title guidance:',
    '- Make the title specific and short.',
    '- Prefer 3 to 8 words.',
    '- If the user supplied a title hint, improve it instead of copying generic filler.',
    '- Do not use labels like "Working answer" or "Related concept" unless the content truly requires it.',
    '- Make the title reflect the action. Example: a question should sound like a question.',
    '',
    'Body guidance:',
    '- The BODY section must be valid markdown.',
    '- Do not repeat the title as a markdown heading at the top of the body.',
    '- Use short paragraphs and bullets only when they help clarity.',
    selectionText
      ? '- Focus the node on the selected excerpt first, then connect it back to the larger node.'
      : '- Focus the node on the source node as a whole.',
  ].join('\n')
}

function parseGeneratedNode(rawAnswer) {
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

async function runCodex(prompt, model) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-mind-codex-'))
  const outputFile = path.join(tempDir, 'last-message.txt')

  try {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-last-message',
      outputFile,
      '-',
    ]

    const targetModel = model || process.env.CODEX_MODEL
    if (targetModel) {
      args.splice(1, 0, '--model', targetModel)
    }

    const child = spawn('codex', args, {
      cwd: rootDir,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    let stdout = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.stdin.write(prompt)
    child.stdin.end()

    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || 'Codex exec failed.')
    }

    const answer = (await fs.readFile(outputFile, 'utf8')).trim()
    if (!answer) {
      throw new Error('Codex returned an empty answer.')
    }

    return {
      answer,
      model: targetModel || 'default',
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

app.get('/api/codex/status', async (_req, res) => {
  const status = await getCodexLoginStatus()
  res.json(status)
})

app.get('/api/providers/status', async (_req, res) => {
  const codex = await getCodexLoginStatus()
  const claude = await getClaudeStatus()

  res.json({
    codex: {
      available: codex.available,
      ready: codex.loggedIn,
      statusText: codex.statusText,
      displayStatus: codex.displayStatus,
      authSource: codex.authSource,
      defaultModel: codex.defaultModel,
      reasoningEffort: codex.reasoningEffort,
    },
    claude,
  })
})

app.post('/api/codex/generate-answer', async (req, res) => {
  try {
    const {
      workspaceTitle,
      workspaceDescription,
      nodeTitle,
      nodeBody,
      graphContext,
      model,
    } = req.body ?? {}

    if (!nodeTitle || typeof nodeTitle !== 'string') {
      return res.status(400).json({ error: 'nodeTitle is required.' })
    }

    const status = await getCodexLoginStatus()
    if (!status.loggedIn) {
      return res.status(400).json({
        error: 'Codex CLI is not logged in. Run `codex login` first.',
      })
    }

    const prompt = buildAnswerPrompt({
      workspaceTitle,
      workspaceDescription,
      nodeTitle,
      nodeBody,
      graphContext: Array.isArray(graphContext) ? graphContext : [],
    })

    const result = await runCodex(prompt, typeof model === 'string' ? model.trim() : '')
    return res.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Codex generation error.'
    return res.status(500).json({ error: message })
  }
})

app.post('/api/codex/generate-node', async (req, res) => {
  try {
    const {
      workspaceTitle,
      workspaceDescription,
      sourceNodeTitle,
      sourceNodeBody,
      graphContext,
      action,
      draftTitle,
      draftBody,
      relation,
      selectionText,
      model,
    } = req.body ?? {}

    if (!sourceNodeTitle || typeof sourceNodeTitle !== 'string') {
      return res.status(400).json({ error: 'sourceNodeTitle is required.' })
    }

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required.' })
    }

    const status = await getCodexLoginStatus()
    if (!status.loggedIn) {
      return res.status(400).json({
        error: 'Codex CLI is not logged in. Run `codex login` first.',
      })
    }

    const prompt = buildNodePrompt({
      workspaceTitle,
      workspaceDescription,
      sourceNodeTitle,
      sourceNodeBody,
      graphContext: Array.isArray(graphContext) ? graphContext : [],
      action,
      draftTitle,
      draftBody,
      relation,
      selectionText: typeof selectionText === 'string' ? selectionText.trim() : '',
    })

    const result = await runCodex(prompt, typeof model === 'string' ? model.trim() : '')
    return res.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Codex node generation error.'
    return res.status(500).json({ error: message })
  }
})

app.get('/api/health', async (_req, res) => {
  const status = await getCodexLoginStatus()
  res.json({
    ok: true,
    codex: status,
  })
})

app.use(express.static(distDir))

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next()
  }

  return res.sendFile(path.join(distDir, 'index.html'), (error) => {
    if (error) {
      next()
    }
  })
})

app.listen(port, host, () => {
  console.log(`Vibe Mind server listening on http://${host}:${port}`)
})
