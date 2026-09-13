import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import path from "path"
import fs from "fs"

const LEDGER_DIR = ".opencode/ledger"
const TASKS_FILE = "tasks.json"
const RATE_LIMITS_FILE = "rate_limits.json"

interface Task {
  id: string
  title: string
  spec: string
  status: "pending" | "dispatched" | "running" | "completed" | "failed" | "integrated" | "rejected"
  class: "tiny" | "simple" | "standard" | "hard"
  agent: string
  session_id: string | null
  depends_on: string[]
  path_pattern: string
  created_at: string
  dispatched_at: string | null
  completed_at: string | null
  result_summary: string | null
  rubric_passed: boolean | null
}

interface Ledger {
  version: number
  next_id: number
  tasks: Record<string, Task>
}

interface RateLimit {
  exhausted_at: string
  refresh_at: string
  reason: string
}

interface RateLimits {
  version: number
  limits: Record<string, RateLimit>
}

// Map agents to their providers
const AGENT_PROVIDER: Record<string, string> = {
  "worker-fast": "opencode-go",
  "worker-fast-2": "opencode-go",
  "worker-fast-3": "opencode-go",
  "worker-main": "opencode-go",
  "worker-main-2": "claude-code",
  "worker-main-3": "opencode-go",
  "worker-smart": "opencode-go",
  "worker-smart-2": "claude-code",
  "worker-smart-3": "openai",
  "reviewer": "openai",
}

const ROUTING: Record<string, string[]> = {
  tiny: ["worker-fast", "worker-fast-2", "worker-fast-3"],
  simple: ["worker-main", "worker-main-2", "worker-main-3"],
  standard: ["worker-main", "worker-main-2", "worker-main-3"],
  hard: ["worker-smart", "worker-smart-2", "worker-smart-3"],
}

function ledgerPath(worktree: string): string {
  return path.join(worktree, LEDGER_DIR, TASKS_FILE)
}

function rateLimitsPath(worktree: string): string {
  return path.join(worktree, LEDGER_DIR, RATE_LIMITS_FILE)
}

function readLedger(worktree: string): Ledger {
  const fp = ledgerPath(worktree)
  if (!fs.existsSync(fp)) {
    return { version: 1, next_id: 1, tasks: {} }
  }
  return JSON.parse(fs.readFileSync(fp, "utf-8"))
}

function writeLedger(worktree: string, ledger: Ledger): void {
  const fp = ledgerPath(worktree)
  const dir = path.dirname(fp)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fp, JSON.stringify(ledger, null, 2))
}

function readRateLimits(worktree: string): RateLimits {
  const fp = rateLimitsPath(worktree)
  if (!fs.existsSync(fp)) {
    return { version: 1, limits: {} }
  }
  return JSON.parse(fs.readFileSync(fp, "utf-8"))
}

function isProviderRateLimited(rateLimits: RateLimits, provider: string): boolean {
  const limit = rateLimits.limits[provider]
  if (!limit) return false
  const refreshAt = new Date(limit.refresh_at)
  return new Date() < refreshAt
}

function getRateLimitedProviders(rateLimits: RateLimits): string[] {
  const now = new Date()
  return Object.entries(rateLimits.limits)
    .filter(([_, limit]) => now < new Date(limit.refresh_at))
    .map(([provider, limit]) => `${provider} (refreshes at ${limit.refresh_at})`)
}

export default tool({
  description:
    "Create a new delegation task in the ledger. Returns the task ID and recommended agent. " +
    "Automatically skips rate-limited providers and suggests fallback lanes. " +
    "After calling this, dispatch the task by spawning a subagent session with the recommended agent.",
  args: {
    title: z.string().describe("Concise title for the task"),
    spec: z
      .string()
      .describe(
        "Detailed self-contained work order: what to do, which files, expected behavior, constraints. Do NOT include conversation history."
      ),
    task_class: z
      .enum(["tiny", "simple", "standard", "hard"])
      .describe("Difficulty class: tiny (fast workers), simple/standard (main workers), hard (smart workers)"),
    path_pattern: z
      .string()
      .default("**/*")
      .describe("Glob pattern for files this task touches, used for conflict detection between parallel tasks"),
    depends_on: z
      .array(z.string())
      .default([])
      .describe("Array of task IDs that must complete before this task can start"),
  },
  async execute(args, context) {
    const ledger = readLedger(context.worktree)
    const rateLimits = readRateLimits(context.worktree)
    const id = `DEL-${ledger.next_id}`
    ledger.next_id++

    const lanes = ROUTING[args.task_class] || ["worker-main"]
    
    // Track busy agents
    const busyAgents = new Set(
      Object.values(ledger.tasks)
        .filter((t) => t.status === "dispatched" || t.status === "running")
        .map((t) => t.agent)
    )
    
    // Categorize each lane
    const rateLimitedProviders = new Set<string>()
    const availableLanes: string[] = []
    
    for (const lane of lanes) {
      const provider = AGENT_PROVIDER[lane]
      if (isProviderRateLimited(rateLimits, provider)) {
        rateLimitedProviders.add(provider)
      } else if (!busyAgents.has(lane)) {
        availableLanes.push(lane)
      }
    }
    
    // Pick the best available agent
    let agent: string
    let reason: string
    
    if (availableLanes.length > 0) {
      agent = availableLanes[0]
      reason = availableLanes.length === lanes.length
        ? `Task ${id} created. Dispatch to ${agent}.`
        : `Task ${id} created. Dispatch to ${agent}. (${lanes.length - availableLanes.length} lane(s) unavailable: ${[...rateLimitedProviders].join(", ")} rate-limited)`
    } else if (rateLimitedProviders.size > 0 && rateLimitedProviders.size < lanes.length) {
      // Some lanes rate-limited, rest busy — assign to first non-rate-limited (even if busy)
      const nonRateLimitedLanes = lanes.filter((l) => !isProviderRateLimited(rateLimits, AGENT_PROVIDER[l]))
      agent = nonRateLimitedLanes[0]
      reason = `Task ${id} created. Dispatch to ${agent} (queued — all non-rate-limited lanes busy). Rate-limited: ${[...rateLimitedProviders].join(", ")}`
    } else if (rateLimitedProviders.size === lanes.length) {
      // All lanes rate-limited
      agent = lanes[0]
      reason = `All ${args.task_class} lanes rate-limited (${[...rateLimitedProviders].join(", ")}). Assigned to ${agent} but will likely fail. Use mark_rate_limited with refresh_minutes: 0 to clear limits when refreshed.`
    } else {
      // All lanes busy
      agent = lanes[0]
      reason = `All ${args.task_class} lanes busy. Assigned to ${agent} (queued).`
    }

    const task: Task = {
      id,
      title: args.title,
      spec: args.spec,
      status: "pending",
      class: args.task_class,
      agent,
      session_id: null,
      depends_on: args.depends_on,
      path_pattern: args.path_pattern,
      created_at: new Date().toISOString(),
      dispatched_at: null,
      completed_at: null,
      result_summary: null,
      rubric_passed: null,
    }

    ledger.tasks[id] = task
    writeLedger(context.worktree, ledger)

    return JSON.stringify({
      task_id: id,
      agent,
      rate_limited_providers: getRateLimitedProviders(rateLimits),
      status: "pending",
      message: reason,
    })
  },
})
