import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import path from "path"
import fs from "fs"

export default tool({
  description:
    "Read multiple files wrapped in XML tags for delegation to a worker. " +
    "Use this instead of reading files directly when files are large (>350 lines) or when you need to ask questions across multiple files. " +
    "Returns the files wrapped in XML with clear boundaries, ready to pass to a worker.",
  args: {
    file_paths: z.array(z.string()).describe("Paths to files to read"),
    question: z
      .string()
      .optional()
      .describe("Question to answer about the files (optional, for context)"),
  },
  async execute(args, context) {
    const results: { path: string; content: string; lines: number }[] = []
    let total_lines = 0

    for (const fp of args.file_paths) {
      const full_path = path.isAbsolute(fp) ? fp : path.join(context.worktree, fp)
      
      if (!fs.existsSync(full_path)) {
        results.push({
          path: fp,
          content: `ERROR: File not found: ${full_path}`,
          lines: 0,
        })
        continue
      }

      try {
        const content = fs.readFileSync(full_path, "utf-8")
        const lines = content.split("\n").length
        total_lines += lines
        
        results.push({
          path: fp,
          content,
          lines,
        })
      } catch (err) {
        results.push({
          path: fp,
          content: `ERROR: Could not read file: ${err}`,
          lines: 0,
        })
      }
    }

    // Escape XML special characters in attribute values
    const escapeXml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    // Format as XML-wrapped content
    let output = ""
    for (const result of results) {
      output += `<file path="${escapeXml(result.path)}" lines="${result.lines}">\n`
      output += result.content
      output += "\n</file>\n\n"
    }

    if (args.question) {
      output += `Question: ${args.question}\n`
    }

    const estimated_tokens = Math.round(total_lines / 4)

    return JSON.stringify({
      content: output,
      metadata: {
        files_read: results.length,
        total_lines,
        estimated_input_tokens: estimated_tokens,
        message: `Read ${results.length} files (${total_lines} lines, ~${estimated_tokens} tokens). Pass this to a worker to answer the question without loading into orchestrator context.`,
      },
    })
  },
})
