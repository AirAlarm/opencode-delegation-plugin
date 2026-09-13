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
        const agentId = (event as any).properties?.agentID || (event as any).properties?.agent

        for (const task of Object.values(ledger.tasks)) {
          // Match by session_id if available, otherwise by agent name
          const matchesSession = task.session_id === sessionId
          const matchesAgent = agentId && task.agent === agentId
          
          if ((matchesSession || matchesAgent) && (task.status === "dispatched" || task.status === "running")) {
            task.status = "completed"
            task.completed_at = new Date().toISOString()
            writeLedger(worktree, ledger)

            await client.app.log({
              body: {
                service: "delegation-plugin",
                level: "info",
                message: `Task ${task.id} completed (session idle)`,
                extra: { task_id: task.id, session_id: sessionId, agent: agentId },
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
        const agentId = (event as any).properties?.agentID || (event as any).properties?.agent

        for (const task of Object.values(ledger.tasks)) {
          const matchesSession = task.session_id === sessionId
          const matchesAgent = agentId && task.agent === agentId
          
          if ((matchesSession || matchesAgent) && (task.status === "dispatched" || task.status === "running")) {
            task.status = "failed"
            task.completed_at = new Date().toISOString()
            writeLedger(worktree, ledger)

            await client.app.log({
              body: {
                service: "delegation-plugin",
                level: "error",
                message: `Task ${task.id} failed with session error`,
                extra: { task_id: task.id, session_id: sessionId, agent: agentId },
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
            message: "Delegation task being created",
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
                message: `Task ${result.task_id} created for ${result.agent}`,
                extra: result,
              },
            })
          }
        } catch {
          // result may not be JSON
        }
      }

      // Track session_id when Task tool creates a subagent session
      if (input.tool === "task") {
        try {
          const result = JSON.parse(output.result || "{}")
          const sessionId = result.session_id || result.sessionId
          const agentName = output.args?.subagent_type

          if (sessionId && agentName) {
            const ledger = readLedger(worktree)
            if (ledger) {
              // Find the most recent pending/dispatched task for this agent
              const tasks = Object.values(ledger.tasks)
                .filter((t: any) => t.agent === agentName && (t.status === "pending" || t.status === "dispatched"))
                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

              if (tasks.length > 0) {
                const task = tasks[0]
                task.session_id = sessionId
                task.status = "dispatched"
                task.dispatched_at = new Date().toISOString()
                writeLedger(worktree, ledger)

                await client.app.log({
                  body: {
                    service: "delegation-plugin",
                    level: "info",
                    message: `Task ${task.id} linked to session ${sessionId}`,
                    extra: { task_id: task.id, session_id: sessionId, agent: agentName },
                  },
                })
              }
            }
          }
        } catch {
          // result may not be JSON or session tracking may fail
        }
      }
    },
  }
}
