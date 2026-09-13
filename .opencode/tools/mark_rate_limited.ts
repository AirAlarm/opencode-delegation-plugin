import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import path from "path"
import fs from "fs"

const LEDGER_DIR = ".opencode/ledger"
const RATE_LIMITS_FILE = "rate_limits.json"

interface RateLimit {
  exhausted_at: string
  refresh_at: string
  reason: string
}

interface RateLimits {
  version: number
  limits: Record<string, RateLimit>
}

function rateLimitsPath(worktree: string): string {
  return path.join(worktree, LEDGER_DIR, RATE_LIMITS_FILE)
}

function readRateLimits(worktree: string): RateLimits {
  const fp = rateLimitsPath(worktree)
  if (!fs.existsSync(fp)) {
    return { version: 1, limits: {} }
  }
  return JSON.parse(fs.readFileSync(fp, "utf-8"))
}

function writeRateLimits(worktree: string, rateLimits: RateLimits): void {
  const fp = rateLimitsPath(worktree)
  const dir = path.dirname(fp)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(fp, JSON.stringify(rateLimits, null, 2))
}

export default tool({
  description:
    "Mark a provider as rate-limited. Use when a worker reports session limits exhausted or rate limit errors. " +
    "The delegate tool will skip this provider until the refresh time passes. " +
    "Common providers: opencode-go, claude-code, openai, anthropic.",
  args: {
    provider: z.string().describe("Provider name (e.g., 'claude-code', 'openai', 'anthropic')"),
    refresh_minutes: z
      .number()
      .default(60)
      .describe("Estimated minutes until rate limit resets. Default 60. Use 0 to clear the limit."),
    reason: z
      .string()
      .default("Rate limit exhausted")
      .describe("Reason for the rate limit (e.g., 'session limit exhausted', '429 Too Many Requests')"),
  },
  async execute(args, context) {
    const rateLimits = readRateLimits(context.worktree)

    if (args.refresh_minutes === 0) {
      // Clear the rate limit
      delete rateLimits.limits[args.provider]
      writeRateLimits(context.worktree, rateLimits)
      return JSON.stringify({
        provider: args.provider,
        status: "cleared",
        message: `Rate limit for ${args.provider} cleared.`,
      })
    }

    const now = new Date()
    const refreshAt = new Date(now.getTime() + args.refresh_minutes * 60 * 1000)

    rateLimits.limits[args.provider] = {
      exhausted_at: now.toISOString(),
      refresh_at: refreshAt.toISOString(),
      reason: args.reason,
    }

    writeRateLimits(context.worktree, rateLimits)

    return JSON.stringify({
      provider: args.provider,
      status: "rate_limited",
      exhausted_at: now.toISOString(),
      refresh_at: refreshAt.toISOString(),
      refresh_minutes: args.refresh_minutes,
      reason: args.reason,
      message: `${args.provider} marked as rate-limited. Will refresh at ${refreshAt.toISOString()}. Delegate tool will skip this provider until then.`,
    })
  },
})
