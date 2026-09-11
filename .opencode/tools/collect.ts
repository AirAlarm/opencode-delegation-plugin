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

function writeLedger(worktree: string, ledger: Ledger): void {
  const fp = ledgerPath(worktree)
  fs.writeFileSync(fp, JSON.stringify(ledger, null, 2))
}

export default tool({
  description:
    "Collect the result of a completed delegation task. Reads the worker's output from the child session, " +
    "updates the ledger status, and returns the result summary for review. " +
    "Use this after a worker session finishes (session.idle event).",
  args: {
    task_id: z.string().describe("The task ID to collect results for (e.g. DEL-1)"),
    result_summary: z
      .string()
      .describe("Summary of what the worker accomplished. Extract from the worker session's final message."),
    rubric_passed: z
      .boolean()
      .describe(
        "Whether the result passes the rubric: correct, no regressions, follows conventions, scoped to work order. Set false to reject."
      ),
  },
  async execute(args, context) {
    const ledger = readLedger(context.worktree)
    const task = ledger.tasks[args.task_id]

    if (!task) {
      return JSON.stringify({ error: `Task ${args.task_id} not found` })
    }

    if (task.status !== "completed" && task.status !== "dispatched" && task.status !== "running" && task.status !== "pending") {
      return JSON.stringify({
        error: `Task ${args.task_id} is in status '${task.status}', cannot collect`,
      })
    }

    task.status = args.rubric_passed ? "completed" : "rejected"
    task.completed_at = new Date().toISOString()
    task.result_summary = args.result_summary
    task.rubric_passed = args.rubric_passed

    writeLedger(context.worktree, ledger)

    return JSON.stringify({
      task_id: args.task_id,
      status: task.status,
      rubric_passed: args.rubric_passed,
      result_summary: args.result_summary,
      message: args.rubric_passed
        ? `Task ${args.task_id} collected. Use 'integrate' to apply changes.`
        : `Task ${args.task_id} rejected. Consider escalating to worker-smart or handling manually.`,
    })
  },
})
