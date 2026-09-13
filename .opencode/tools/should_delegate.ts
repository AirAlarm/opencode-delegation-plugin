import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import path from "path"
import fs from "fs"

const MIN_LINES = 350 // Threshold for bulk read delegation

export default tool({
  description:
    "Analyze whether a task should be delegated to save tokens. Returns recommendation with reasoning. " +
    "Use this before reading large files or generating boilerplate to decide if delegation saves tokens.",
  args: {
    task_type: z
      .enum(["read", "generate", "edit", "analyze"])
      .describe("Type of task: read (file reading), generate (boilerplate), edit (code changes), analyze (reasoning)"),
    file_paths: z
      .array(z.string())
      .optional()
      .describe("Files involved in the task (for read/analyze tasks)"),
    estimated_lines: z
      .number()
      .optional()
      .describe("Estimated lines of output (for generate tasks)"),
    requires_reasoning: z
      .boolean()
      .default(false)
      .describe("Whether the task requires complex reasoning, debugging, or architectural decisions"),
  },
  async execute(args, context) {
    const recommendations: {
      should_delegate: boolean
      reason: string
      suggested_worker: string
      estimated_savings: string
    }[] = []

    // Check file sizes for read tasks
    if (args.task_type === "read" && args.file_paths) {
      let total_lines = 0
      const large_files: string[] = []

      for (const fp of args.file_paths) {
        const full_path = path.isAbsolute(fp) ? fp : path.join(context.worktree, fp)
        if (fs.existsSync(full_path)) {
          const content = fs.readFileSync(full_path, "utf-8")
          const lines = content.split("\n").length
          total_lines += lines
          if (lines > MIN_LINES) {
            large_files.push(`${fp} (${lines} lines)`)
          }
        }
      }

      if (large_files.length > 0) {
        recommendations.push({
          should_delegate: true,
          reason: `Large files detected: ${large_files.join(", ")}. Total: ${total_lines} lines.`,
          suggested_worker: "worker-fast",
          estimated_savings: `~${Math.round((total_lines * 0.9) / 4)} tokens saved by delegating to cheaper model`,
        })
      } else {
        recommendations.push({
          should_delegate: false,
          reason: `Files are small (${total_lines} lines total). Direct read is more efficient.`,
          suggested_worker: "orchestrator",
          estimated_savings: "No savings - delegation overhead exceeds cost",
        })
      }
    }

    // Check generate tasks
    if (args.task_type === "generate") {
      const lines = args.estimated_lines || 0
      if (lines > 200 && !args.requires_reasoning) {
        recommendations.push({
          should_delegate: true,
          reason: `Generating ${lines} lines of boilerplate. No complex reasoning required.`,
          suggested_worker: "worker-fast",
          estimated_savings: `~${Math.round((lines * 0.85) / 4)} tokens saved by delegating generation`,
        })
      } else if (args.requires_reasoning) {
        recommendations.push({
          should_delegate: false,
          reason: "Task requires reasoning/debugging. Keep on orchestrator for context.",
          suggested_worker: "orchestrator",
          estimated_savings: "No savings - reasoning must stay on expensive model",
        })
      } else {
        recommendations.push({
          should_delegate: false,
          reason: `Small generation (${lines} lines). Direct generation is more efficient.`,
          suggested_worker: "orchestrator",
          estimated_savings: "No savings - delegation overhead exceeds cost",
        })
      }
    }

    // Edit tasks - always keep on orchestrator unless very large
    if (args.task_type === "edit") {
      recommendations.push({
        should_delegate: false,
        reason: "Edit tasks require exact content in context. Keep on orchestrator.",
        suggested_worker: "orchestrator",
        estimated_savings: "No savings - edits need precise context",
      })
    }

    // Analyze tasks - depends on reasoning requirement
    if (args.task_type === "analyze") {
      if (args.requires_reasoning) {
        recommendations.push({
          should_delegate: false,
          reason: "Analysis requires reasoning. Keep on orchestrator.",
          suggested_worker: "orchestrator",
          estimated_savings: "No savings - reasoning must stay on expensive model",
        })
      } else {
        recommendations.push({
          should_delegate: true,
          reason: "Analysis is straightforward. Can delegate to save tokens.",
          suggested_worker: "worker-fast",
          estimated_savings: "~50% token savings on analysis",
        })
      }
    }

    return JSON.stringify(recommendations, null, 2)
  },
})
