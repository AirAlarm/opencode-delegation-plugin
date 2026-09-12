# OpenCode Delegation Plugin

A multi-agent delegation system for [OpenCode](https://opencode.ai) that orchestrates parallel task execution across multiple AI models, with automatic token optimization inspired by Spotify's [portal-ai-plugins shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt).

## Features

- **Multi-agent orchestration** — Decompose work into parallel tasks across 11 specialized agents
- **Automatic token savings** — ~90% reduction on bulk file reads via smart delegation
- **Rate limit handling** — Automatic fallback when providers hit session limits
- **Parallel execution** — Run multiple workers simultaneously in separate sessions
- **Task ledger** — JSON-based task tracking with dependency management
- **Rubric-based review** — Automated quality checks before integration

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Orchestrator (qwen3.7-plus)                    │
│  Plans → Delegates → Reviews → Integrates       │
└──────────┬──────────────────────────┬───────────┘
           │                          │
    ┌──────▼──────┐           ┌───────▼───────┐
    │  Plugin     │           │  Custom Tools │
    │  (events,   │           │  (delegate,   │
    │   routing)  │           │   collect)    │
    └──────┬──────┘           └──────┬────────┘
    ┌──────▼─────────────────────────▼───────┐
    │         Worker Agents (parallel)       │
    │  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
    │  │fast     │ │main     │ │smart      │ │
    │  │(3 lanes)│ │(3 lanes)│ │(3 lanes)  │ │
    │  └─────────┘ └─────────┘ └───────────┘ │
    └────────────────────────────────────────┘
```

## Agent Configuration

### Orchestrator
- **Model:** `opencode-go/qwen3.7-plus`
- **Role:** Plans work, delegates to workers, reviews results, integrates output

### Worker Tiers

| Tier | Agents | Models | Use Case |
|------|--------|--------|----------|
| **Fast** | worker-fast, worker-fast-2, worker-fast-3 | deepseek-v4-flash, gpt-5.6-luna, glm-5.3-flash | Tiny tasks, bulk reads, boilerplate |
| **Main** | worker-main, worker-main-2, worker-main-3 | minimax-m3, claude-code/sonnet, deepseek-v4-pro | Standard implementation, tests |
| **Smart** | worker-smart, worker-smart-2, worker-smart-3 | glm-5.3, claude-code/opus, gpt-6-astra | Complex reasoning, architecture |
| **Reviewer** | reviewer | gpt-5.6-sol | Read-only code review |

## Installation

### Step 1: Add the plugin to your `opencode.json`

```json
{
  "plugin": ["github:AirAlarm/opencode-delegation-plugin#2426c53"]
}
```

**Important:** Pin to a specific commit hash for faster startup. Without a commit hash, OpenCode checks for updates on every load.

### Step 2: Copy agent definitions to your project

The plugin provides tools, but you need to copy the agent definitions into your project. Choose one method:

**Option A: Copy the agents directory (recommended)**

```bash
# Clone the plugin repo temporarily
git clone https://github.com/AirAlarm/opencode-delegation-plugin /tmp/delegation-plugin

# Copy the agents to your project
cp -r /tmp/delegation-plugin/.opencode/agents /your/project/.opencode/

# Clean up
rm -rf /tmp/delegation-plugin
```

**Option B: Copy agent definitions from opencode.json**

Copy the `agent` section from the plugin's `opencode.json` into your project's `opencode.json`:

```json
{
  "plugin": ["github:AirAlarm/opencode-delegation-plugin#2426c53"],
  "agent": {
    "orchestrator": { ... },
    "worker-fast": { ... },
    "worker-fast-2": { ... },
    // ... copy all agent definitions from the plugin's opencode.json
  }
}
```

### Step 3: Configure providers

Add API keys for the models you want to use:

```bash
cd /your/project
opencode
/connect  # Select each provider and add keys
```

### Step 4: Verify setup

```bash
opencode agents  # Should show orchestrator, worker-fast, worker-main, etc.
opencode models  # Verify your providers are configured
```

### Why two steps?

OpenCode plugins can provide tools and hooks, but agent definitions must be in your project's config. This gives you control over which workers to enable and which models to use.

## Usage

### Basic Workflow

1. **Switch to orchestrator** (Tab key in OpenCode TUI)

2. **Give it a task:**
   ```
   Build a REST API with authentication, tests, and documentation
   ```

3. **Orchestrator will:**
   - Write a plan and wait for your confirmation
   - Decompose into parallel tasks
   - Delegate to workers simultaneously
   - Collect and review results
   - Integrate accepted changes

### Token-Saving Auto-Delegation

The orchestrator automatically delegates bulk operations to save tokens:

**When it delegates:**
- Reading files >350 lines
- Generating >200 lines of boilerplate
- Analyzing patterns across multiple files

**When it doesn't:**
- Debugging (requires reasoning)
- Editing (needs exact context)
- Small files (<350 lines)
- Architectural decisions

**Example:**
```
User: "What does the auth service do?"

Orchestrator:
1. should_delegate(task_type="read", file_paths=["src/auth/service.ts"])
   → Recommends delegation (file is 2,400 lines)

2. bulk_read(file_paths=["src/auth/service.ts"], question="What does it do?")
   → Returns XML-wrapped content

3. Task(subagent_type="worker-fast", prompt="Analyze...")
   → Worker answers without loading into orchestrator context

Result: ~90% token savings
```

## Custom Tools

### delegate
Creates a task in the ledger with automatic lane selection.
```typescript
delegate({
  title: "Add authentication",
  spec: "Implement JWT auth in src/auth.ts...",
  task_class: "standard",
  path_pattern: "src/auth/**",
  depends_on: []
})
```

### task_status
Queries the task ledger.
```typescript
task_status({
  task_id: "DEL-1",  // optional
  filter: "ready"    // all|pending|dispatched|running|completed|failed|ready
})
```

### collect
Retrieves worker results with rubric evaluation.
```typescript
collect({
  task_id: "DEL-1",
  result_summary: "Implemented JWT auth with...",
  rubric_passed: true
})
```

### integrate
Marks a task as accepted and integrated.
```typescript
integrate({
  task_id: "DEL-1",
  notes: "All tests passing, follows conventions"
})
```

### should_delegate
Analyzes whether a task should be delegated to save tokens.
```typescript
should_delegate({
  task_type: "read",
  file_paths: ["src/auth/service.ts"],
  requires_reasoning: false
})
```

### bulk_read
Reads multiple files wrapped in XML for delegation.
```typescript
bulk_read({
  file_paths: ["src/auth/service.ts", "src/auth/handler.ts"],
  question: "What does the auth service do?"
})
```

### mark_rate_limited
Marks a provider as rate-limited with estimated refresh time.
```typescript
mark_rate_limited({
  provider: "claude-code",
  refresh_minutes: 60,
  reason: "Session limit exhausted"
})
```

## Rate Limit Handling

When workers hit rate limits (429 errors, session limits):

1. Worker reports the error in their summary
2. Orchestrator calls `mark_rate_limited` with the provider name
3. Future `delegate` calls automatically skip that provider
4. When limits refresh, clear with `mark_rate_limited({ refresh_minutes: 0 })`

## File Structure

```
.opencode/
├── agents/
│   ├── orchestrator.md      # Primary supervisor
│   ├── worker-fast.md       # Fast worker (deepseek-v4-flash)
│   ├── worker-fast-2.md     # Fast worker (gpt-5.6-luna)
│   ├── worker-fast-3.md     # Fast worker (glm-5.3-flash)
│   ├── worker-main.md       # Main worker (minimax-m3)
│   ├── worker-main-2.md     # Main worker (claude-code/sonnet)
│   ├── worker-main-3.md     # Main worker (deepseek-v4-pro)
│   ├── worker-smart.md      # Smart worker (glm-5.3)
│   ├── worker-smart-2.md    # Smart worker (claude-code/opus)
│   ├── worker-smart-3.md    # Smart worker (gpt-6-astra)
│   └── reviewer.md          # Code reviewer (gpt-5.6-sol)
├── tools/
│   ├── delegate.ts          # Create tasks
│   ├── task_status.ts       # Query ledger
│   ├── collect.ts           # Retrieve results
│   ├── integrate.ts         # Accept results
│   ├── should_delegate.ts   # Token optimization check
│   ├── bulk_read.ts         # XML-wrapped file reading
│   └── mark_rate_limited.ts # Rate limit tracking
├── plugins/
│   └── delegation.ts        # Event hooks and routing
├── ledger/
│   ├── tasks.json           # Task state (created at runtime)
│   └── rate_limits.json     # Rate limit tracking
└── package.json             # Dependencies (zod)

opencode.json                # Agent configuration
SHUNT_INTEGRATION.md         # Architecture documentation
```

## Token Savings

Based on Spotify's shunt benchmarks:

| Scenario | Lines | Without Delegation | With Delegation | Savings |
|----------|-------|-------------------|-----------------|---------|
| Single large file | 4,014 | 33,684 tokens | 5,737 tokens | **82%** |
| Source + test pair | 7,408 | 75,990 tokens | 4,148 tokens | **94%** |
| Multi-file analysis | 1,281 | 16,221 tokens | 821 tokens | **94%** |

**Mean savings: ~90%** on bulk reads.

## Configuration

### Adjusting Thresholds

Edit `.opencode/tools/should_delegate.ts`:
```typescript
const MIN_LINES = 350  // Change this to adjust the delegation threshold
```

### Adding More Workers

1. Add agent definition in `opencode.json`
2. Create `.opencode/agents/worker-name.md`
3. Update routing in `.opencode/tools/delegate.ts`:
   ```typescript
   const ROUTING: Record<string, string[]> = {
     tiny: ["worker-fast", "worker-fast-2", "worker-fast-3", "worker-name"],
     // ...
   }
   ```

### Changing Models

Update model IDs in:
- `opencode.json` (agent definitions)
- `.opencode/agents/*.md` (agent prompts)

## Architecture Decisions

### Why Not Spotify Portal/AiKA?

We studied shunt's patterns but use native OpenCode subagents instead of external dependencies. This gives us:
- Direct integration with OpenCode's session management
- No additional CLI dependencies
- Full control over worker routing and rate limiting

### Why JSON Ledger?

Simple, inspectable, survives restarts. Could be replaced with SQLite for more complex querying, but JSON is sufficient for most use cases.

### Why Multiple Lanes?

Different models excel at different tasks. Having 3 lanes per tier allows:
- True parallel execution (up to 9 workers simultaneously)
- Fallback when one model is rate-limited
- Cost optimization (use cheaper models when possible)

## Limitations

- **No hook enforcement** — OpenCode doesn't have PreToolUse hooks like Claude Code, so auto-delegation relies on orchestrator following instructions
- **Rate limit detection** — Workers must report rate limit errors; no automatic detection
- **Model availability** — Requires API keys for all configured providers

## Contributing

This is a reference implementation. Adapt it to your needs:
- Add more specialized workers
- Adjust routing logic
- Modify the rubric in `reviewer.md`
- Extend the ledger schema

## License

MIT

## Credits

- Inspired by [Spotify's portal-ai-plugins shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt)
- Built for [OpenCode](https://opencode.ai)
- Uses models from OpenCode Go, Claude Code, and OpenAI
