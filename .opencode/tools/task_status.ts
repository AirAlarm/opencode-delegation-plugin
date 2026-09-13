import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import path from "path"
import fs from "fs"

const LEDGER_DIR = ".opencode/ledger"
const LEDGER_FILE = "tasks.json"

interface Ledger {
  version: number
  next_id: number
  tasks: Record<string, any>
}

function ledgerPath(worktree: string): string {
  return path.join(worktree, LEDGER_DIR, LEDGER_FILE)
}

function readLedger(worktree: string): Ledger {
  const fp = ledgerPath(worktree)
  if (!fs.existsSync(fp)) {
    return { version: 1, next_id: 1, tasks: {} }
  }
  return JSON.parse(fs.readFileSync(fp, "utf-8"))
}

export default tool({
  description:
    "Check the status of delegation tasks. Returns a summary of all tasks, or details for a specific task. " +
    "Use this to see what is pending, running, completed, or failed.",
  args: {
    task_id: z
      .string()
      .optional()
      .describe("Specific task ID to inspect (e.g. DEL-1). Omit to see all tasks."),
    filter: z
      .enum(["all", "pending", "dispatched", "running", "completed", "failed", "integrated", "rejected", "ready"])
      .default("all")
      .describe(
        "Filter tasks by status. 'ready' shows tasks that are pending and have all dependencies satisfied."
      ),
  },
  async execute(args, context) {
    const ledger = readLedger(context.worktree)
    const tasks = Object.values(ledger.tasks)

    if (args.task_id) {
      const task = ledger.tasks[args.task_id]
      if (!task) {
        return JSON.stringify({ error: `Task ${args.task_id} not found` })
      }
      return JSON.stringify(task, null, 2)
    }

    let filtered = tasks
    if (args.filter === "ready") {
      const completedIds = new Set(tasks.filter((t: any) => t.status === "completed" || t.status === "integrated").map((t: any) => t.id))
      filtered = tasks.filter((t: any) => {
        if (t.status !== "pending") return false
        return t.depends_on.every((dep: string) => completedIds.has(dep))
      })
    } else if (args.filter !== "all") {
      filtered = tasks.filter((t: any) => t.status === args.filter)
    }

    const summary = {
      total: tasks.length,
      by_status: tasks.reduce((acc: Record<string, number>, t: any) => {
        acc[t.status] = (acc[t.status] || 0) + 1
        return acc
      }, {}),
      tasks: filtered.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        class: t.class,
        agent: t.agent,
        depends_on: t.depends_on,
      })),
    }

    return JSON.stringify(summary, null, 2)
  },
})
