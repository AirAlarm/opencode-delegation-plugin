# Delegation Plugin Architecture - Shunt Integration

## Overview

This document describes the architectural patterns integrated from Spotify's portal-ai-plugins shunt plugin to improve token efficiency in our delegation system.

## What We Integrated

### 1. Threshold-Based Auto-Delegation

**Pattern from shunt:** Only delegate when it saves tokens (>350 lines for reads, >200 lines for generation).

**Our implementation:**
- `should_delegate` tool analyzes tasks before execution
- Returns recommendation with reasoning and estimated savings
- Checks file sizes, task types, and reasoning requirements

**Files:**
- `.opencode/tools/should_delegate.ts`

### 2. XML-Wrapped Bulk Context

**Pattern from shunt:** Wrap files in XML tags (`<file path="...">`) for clear boundaries when passing to workers.

**Our implementation:**
- `bulk_read` tool reads multiple files and wraps them in XML
- Returns structured content ready to pass to workers
- Includes metadata (line counts, estimated tokens)

**Files:**
- `.opencode/tools/bulk_read.ts`

### 3. Auto-Delegation Workflow

**Pattern from shunt:** Orchestrator automatically checks if work should be delegated before doing it.

**Our implementation:**
- Updated orchestrator instructions with "Auto-Delegation for Token Savings" section
- Clear guidelines on when to delegate vs when not to
- Example workflow showing the decision tree

**Files:**
- `.opencode/agents/orchestrator.md` (updated)

## Token Savings

Based on shunt's benchmarks (tested on 162K-line Java monorepo):

| Scenario | Lines | Without Delegation | With Delegation | Savings |
|----------|-------|-------------------|-----------------|---------|
| Single large file | 4,014 | 33,684 tokens | 5,737 tokens | **82%** |
| Source + test pair | 7,408 | 75,990 tokens | 4,148 tokens | **94%** |
| Multi-file cross-service | 1,281 | 16,221 tokens | 821 tokens | **94%** |

**Mean savings: ~90%** on bulk reads.

## When to Auto-Delegate

### ✅ Delegate to worker-fast

1. **Bulk file reads** (>350 lines or 3+ files)
   - Use `bulk_read` to wrap files in XML
   - Delegate to worker-fast with specific question
   - Saves ~90% tokens vs reading directly

2. **Boilerplate generation** (>200 lines, no reasoning)
   - Tests, configs, repetitive patterns
   - Delegate to worker-fast with clear spec
   - Provide reference files for pattern matching

3. **Multi-file analysis** (no complex reasoning)
   - Pattern detection across files
   - Code structure analysis
   - Dependency mapping

### ❌ Keep on orchestrator

1. **Debugging** — requires reasoning and context
2. **Editing** — needs exact content in context (use targeted reads with offset/limit)
3. **Small files** (<350 lines) — delegation overhead exceeds savings
4. **Architectural decisions** — judgment calls require expensive model reasoning

## Implementation Details

### should_delegate Tool

```typescript
Input:
- task_type: "read" | "generate" | "edit" | "analyze"
- file_paths: string[] (for read/analyze)
- estimated_lines: number (for generate)
- requires_reasoning: boolean

Output:
- should_delegate: boolean
- reason: string
- suggested_worker: string
- estimated_savings: string
```

### bulk_read Tool

```typescript
Input:
- file_paths: string[]
- question?: string (optional context)

Output:
- content: XML-wrapped file content
- metadata: { files_read, total_lines, estimated_input_tokens }
```

### Orchestrator Workflow

```
1. User asks: "What does the auth service do?"

2. Orchestrator calls:
   should_delegate(task_type="read", file_paths=["src/auth/service.ts", "src/auth/handler.ts"])
   → Returns: should_delegate=true

3. Orchestrator calls:
   bulk_read(file_paths=["src/auth/service.ts", "src/auth/handler.ts"], question="What does the auth service do?")
   → Returns: XML-wrapped content

4. Orchestrator delegates:
   Task(subagent_type="worker-fast", prompt="Analyze these files...")
   → Worker answers without loading into orchestrator context

5. Orchestrator reports answer to user
```

## What We Did NOT Integrate

### Portal CLI / AiKA

**Why not:** We have our own worker system with native OpenCode subagents. No need for external dependencies.

**Our alternative:** Direct Task tool calls to worker-fast/worker-main/worker-smart agents.

### Hook Enforcement

**Why not:** OpenCode doesn't have the same PreToolUse hook system as Claude Code. We use tool-based interception instead.

**Our alternative:** `should_delegate` tool that orchestrator calls before reading files.

### Bash Scripts

**Why not:** We use TypeScript tools for better type safety and integration with OpenCode's plugin system.

**Our alternative:** TypeScript tools in `.opencode/tools/`.

## Future Enhancements

1. **Automatic threshold tuning** — Adjust MIN_LINES based on actual token savings
2. **Smart reference selection** — Auto-pick reference files for boilerplate generation
3. **Conversation-aware delegation** — Track which files are already in context
4. **Cost tracking** — Log token savings per delegation

## References

- Spotify portal-ai-plugins: https://github.com/spotify/portal-ai-plugins
- Shunt plugin: https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt
- Shunt benchmarks: 82-94% token savings on bulk reads
