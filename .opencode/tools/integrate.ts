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
    "Mark a completed delegation task as integrated. The worker's changes are already in the working tree " +
    "(applied by the subagent session). This updates the ledger to reflect that the orchestrator has reviewed " +
    "and accepted the changes.",
  args: {
    task_id: z.string().describe("The task ID to mark as integrated (e.g. DEL-1)"),
    notes: z.string().optional().describe("Optional notes about the integration"),
  },
  async execute(args, context) {
    const ledger = readLedger(context.worktree)
    const task = ledger.tasks[args.task_id]

    if (!task) {
      return JSON.stringify({ error: `Task ${args.task_id} not found` })
    }

    if (task.status !== "completed") {
      return JSON.stringify({
        error: `Task ${args.task_id} is in status '${task.status}'. Only 'completed' tasks can be integrated.`,
      })
    }

    task.status = "integrated"
    writeLedger(context.worktree, ledger)

    return JSON.stringify({
      task_id: args.task_id,
      status: "integrated",
      message: `Task ${args.task_id} marked as integrated.`,
    })
  },
})
