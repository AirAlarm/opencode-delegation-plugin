import { type Plugin } from "@opencode-ai/plugin"
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

function readLedger(worktree: string): Ledger | null {
  const fp = ledgerPath(worktree)
  if (!fs.existsSync(fp)) return null
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

export const DelegationPlugin: Plugin = async ({ client, directory, worktree }) => {
  await client.app.log({
    body: {
      service: "delegation-plugin",
      level: "info",
      message: "Delegation plugin loaded",
      extra: { worktree },
    },
  })

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const ledger = readLedger(worktree)
        if (!ledger) return

        const sessionId = (event as any).properties?.sessionID
        if (!sessionId) return

        for (const task of Object.values(ledger.tasks)) {
          if (task.session_id === sessionId && task.status === "dispatched") {
            task.status = "running"
            writeLedger(worktree, ledger)

            await client.app.log({
              body: {
                service: "delegation-plugin",
                level: "info",
                message: `Task ${task.id} session went idle`,
                extra: { task_id: task.id, session_id: sessionId },
              },
            })
            break
          }
        }
      }

      if (event.type === "session.error") {
        const ledger = readLedger(worktree)
        if (!ledger) return

        const sessionId = (event as any).properties?.sessionID
        if (!sessionId) return

        for (const task of Object.values(ledger.tasks)) {
          if (task.session_id === sessionId && (task.status === "dispatched" || task.status === "running")) {
            task.status = "failed"
            task.completed_at = new Date().toISOString()
            writeLedger(worktree, ledger)

            await client.app.log({
              body: {
                service: "delegation-plugin",
                level: "error",
                message: `Task ${task.id} failed with session error`,
                extra: { task_id: task.id, session_id: sessionId },
              },
            })
            break
          }
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      if (input.tool === "delegate") {
        await client.app.log({
          body: {
            service: "delegation-plugin",
            level: "debug",
            message: "Delegation task created",
            extra: { args: output.args },
          },
        })
      }
    },

    "tool.execute.after": async (input, output) => {
      if (input.tool === "delegate") {
        try {
          const result = JSON.parse(output.result || "{}")
          if (result.task_id) {
            await client.app.log({
              body: {
                service: "delegation-plugin",
                level: "info",
                message: `Task ${result.task_id} dispatched to ${result.agent}`,
                extra: result,
              },
            })
          }
        } catch {
          // result may not be JSON
        }
      }
    },
  }
}
