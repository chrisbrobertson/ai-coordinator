# AI Spec Coordinator - Feature Specification

---
specmas: v3
kind: FeatureSpec
id: feat-ai-spec-coordinator
name: AI Spec Coordinator
version: 1.0.0
owners:
  - name: Chris
complexity: MODERATE
maturity: 4
tags: [cli, orchestration, ai-tools, spec-mas, automation, npm]
---

## Overview

### Problem Statement
Building software from specifications requires iterative implementation and review cycles. Currently, developers must manually run AI coding assistants, review outputs, and coordinate feedback loops. This is time-consuming and prone to human oversight gaps. By orchestrating multiple AI assistants—one implementing, others validating—we can achieve higher quality implementations with reduced manual intervention across entire projects with multiple specs.

### Scope
**In Scope:**
- Globally installable CLI tool (`npm install -g ai-spec-coordinator`)
- Orchestrate AI coding assistants (Claude Code, OpenAI Codex/Cortex, Gemini CLI)
- Lead/validator role assignment for AI tools
- Multi-spec discovery and dependency-ordered processing from `specs/` directory
- Automated validation cycles with spec-based gap analysis
- Consensus-based completion detection per spec
- Session state management and resumability across specs
- Configurable tool preferences and iteration limits

**Out of Scope:**
- GUI/web interface (CLI only for v1)
- Creating or modifying spec files (assumes valid Spec-MAS specs exist)
- Direct API integration (uses CLI wrappers only)
- Training or fine-tuning AI models
- Cross-project coordination (single project/working directory at a time)

### Success Metrics
- 90% of valid specs reach consensus within 5 validation cycles
- Implementation gap detection rate ≥ 95% (validated against manual review)
- Average time to consensus < 30 minutes for EASY complexity specs
- Dependency ordering correctly resolves 100% of declared dependencies
- Zero orphaned sessions (all sessions complete or explicitly abandoned)

---

## Installation & Deployment

### Installation Methods

**Via npm (recommended):**
```bash
npm install -g ai-spec-coordinator
```

**Via yarn:**
```bash
yarn global add ai-spec-coordinator
```

**Via pnpm:**
```bash
pnpm add -g ai-spec-coordinator
```

**From source:**
```bash
git clone https://github.com/[org]/ai-spec-coordinator.git
cd ai-spec-coordinator
npm install
npm run build
npm link
```

### Post-Installation Verification
```bash
# Verify installation (either command works)
aic --version
ai-coord --version

# Check available AI tools
aic tools

# Expected output:
# ai-spec-coordinator v1.0.0
# 
# Available AI Tools:
# ┌─────────┬─────────┬──────────────────────┐
# │ Tool    │ Version │ Status               │
# ├─────────┼─────────┼──────────────────────┤
# │ claude  │ 1.0.3   │ ✓ Ready              │
# │ codex   │ 0.9.1   │ ✓ Ready              │
# │ gemini  │ -       │ ✗ Not found          │
# └─────────┴─────────┴──────────────────────┘
```

### Prerequisites
- Node.js 20.0.0 or higher
- At least 2 AI CLI tools installed and authenticated:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - OpenAI Codex: `npm install -g @openai/codex`
  - Gemini CLI: `npm install -g @google/gemini-cli`

### Package Configuration

**package.json:**
```json
{
  "name": "ai-spec-coordinator",
  "version": "1.0.0",
  "description": "Orchestrate multiple AI coding assistants to implement specs with validation",
  "bin": {
    "ai-coord": "./dist/cli/index.js",
    "aic": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist/**/*"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "keywords": [
    "ai",
    "cli",
    "claude",
    "codex",
    "gemini",
    "specification",
    "automation",
    "code-generation"
  ],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli/index.js",
    "test": "vitest",
    "lint": "eslint src/",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "execa": "^8.0.0",
    "ora": "^8.0.0",
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.0",
    "yaml": "^2.3.0",
    "uuid": "^9.0.0",
    "pino": "^8.0.0",
    "pino-pretty": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "eslint": "^8.0.0"
  }
}
```

### Global State Location
The tool stores session state and logs in the user's home directory:
```
~/.ai-spec-coordinator/
├── config.json          # Global configuration (optional)
├── sessions/            # Session state files
├── reports/             # Generated reports  
└── logs/                # Log files
```

Project-specific state is stored in the working directory:
```
<working_dir>/
├── specs/               # Spec files (user-managed)
├── .ai-coord/           # Project-specific state
│   └── current-session  # Symlink to active session
└── src/                 # Implementation target
```

---

## Functional Requirements

### FR-1: Tool Registration and Discovery
The system must detect and register available AI CLI tools on the host system.

**Supported Tools:**
| Tool | CLI Command | Detection Method |
|------|-------------|------------------|
| Claude Code | `claude` | `which claude` + version check |
| OpenAI Codex | `codex` | `which codex` + version check |
| Gemini CLI | `gemini` | `which gemini` + version check |

**Validation Criteria:**
- Given Claude Code is installed, When the coordinator starts, Then Claude Code is registered as available
- Given no AI tools are installed, When the coordinator starts, Then exit with error "No AI tools found. Install at least one: claude, codex, or gemini"
- Given a tool is installed but not in PATH, When the coordinator starts, Then that tool is not registered
- Tool availability is cached for session duration (no re-detection per cycle)

### FR-2: Role Assignment
The system must assign one tool as "Lead Implementer" and one or more tools as "Validators".

**Assignment Rules:**
1. User can explicitly specify roles via CLI flags
2. If not specified, first available tool becomes Lead (priority: claude > codex > gemini)
3. All other available tools become Validators
4. Minimum configuration: 1 Lead + 1 Validator (error if only 1 tool available)

**Validation Criteria:**
- Given `--lead=codex --validators=claude,gemini`, When session starts, Then Codex is Lead and Claude+Gemini are Validators
- Given only Claude is available, When session starts, Then exit with error "At least 2 AI tools required"
- Given Claude and Codex available with no flags, When session starts, Then Claude is Lead and Codex is Validator

### FR-3: Spec File Discovery and Loading
The system discovers and loads Spec-MAS specification files from the `specs/` directory.

**Default Behavior:**
- Specs are always located in `<working_dir>/specs/`
- By default, all `.md` files in `specs/` with valid Spec-MAS front-matter are loaded
- Specs are processed in dependency order (if dependencies declared) or alphabetically

**Directory Structure:**
```
<working_dir>/
├── specs/
│   ├── feat-auth.md           # Feature spec
│   ├── feat-user-profile.md   # Feature spec
│   ├── feat-billing.md        # Feature spec
│   └── system-architecture.md # Optional system spec (processed first)
├── src/                       # Implementation target
└── ...
```

**Spec Selection:**
```bash
# Default: build all specs in specs/ directory
ai-coord run

# Build specific spec(s)
ai-coord run --specs feat-auth.md,feat-billing.md

# Build specs matching pattern
ai-coord run --specs "feat-*.md"

# Exclude specific specs
ai-coord run --exclude feat-billing.md
```

**Processing Order:**
1. System architecture specs (`system-*.md`) processed first (context only, not implemented)
2. Feature specs processed in order:
   - By `depends_on` field in front-matter (if present)
   - Alphabetically (if no dependencies)

**Multi-Spec Session:**
When multiple specs are loaded:
- Each spec gets its own implementation + validation cycles
- Consensus must be reached on each spec before moving to next
- Session state tracks progress across all specs
- Final report summarizes all specs

**Validation Criteria:**
- Given `specs/` directory exists with valid specs, When `ai-coord run` executes, Then all specs are discovered and queued
- Given `specs/` directory is empty or missing, When session starts, Then exit with error "No specs found in ./specs/"
- Given `--specs feat-auth.md` flag, When session starts, Then only feat-auth.md is processed
- Given a spec with `depends_on: [feat-auth]`, When ordering specs, Then feat-auth.md is processed before dependent spec
- Given a spec with maturity < 3, When spec is loaded, Then warn "Spec {name} maturity {N} is below recommended minimum (3). Continue? [y/N]"
- Given a file in specs/ without valid Spec-MAS front-matter, When discovering specs, Then skip file and log warning

### FR-4: Tool Execution Mode Configuration
The system must configure AI tools for non-interactive (headless) execution with role-appropriate permissions.

**Challenge:** AI coding tools prompt for permission before executing commands, writing files, or making changes. This breaks automated orchestration.

**Default Permission Model (Role-Based):**

| Role | Permissions | Rationale |
|------|-------------|-----------|
| **Lead Implementer** | Full read/write in working directory | Must create/modify code |
| **Validators** | Read-only | Only need to analyze code, not modify |

This is the default behavior — no flags required for standard operation.

**Tool-Specific Permission Mapping:**

| Tool | Lead (Full Access) | Validator (Read-Only) |
|------|-------------------|----------------------|
| Claude Code | `--dangerously-skip-permissions` | `--allowedTools "View,Read,Grep,Glob,LS"` |
| OpenAI Codex | `--approval-mode full-auto` | `--approval-mode read-only` |
| Gemini CLI | `--non-interactive` | `--non-interactive --read-only` |

**Working Directory Scope:**
- All tool operations are scoped to the working directory (cwd or `--dir` flag)
- Lead cannot write outside working directory
- Validators cannot write anywhere

**Optional Overrides:**
```bash
# Restrict Lead to specific operations (more secure)
ai-coord run spec.md --lead-permissions "Edit,Write,Read,Bash(npm test)"

# Sandbox mode - run in Docker container (most secure)
ai-coord run spec.md --sandbox

# Interactive mode - prompt for each action (debugging)
ai-coord run spec.md --interactive
```

**Validation Criteria:**
- Given default configuration, When Lead executes, Then full read/write permissions in working directory
- Given default configuration, When Validator executes, Then read-only permissions (no file writes, no command execution)
- Given `--sandbox` flag, When session starts, Then spawn Docker container and mount codebase as working directory
- Given `--lead-permissions` specified, When Lead executes, Then use scoped permissions instead of full access
- Given tool doesn't support read-only mode, When assigning as Validator, Then warn and use full permissions with audit logging

**Startup Confirmation:**
```
🚀 AI Spec Coordinator
   Working Directory: /home/user/myproject
   Specs Directory:   /home/user/myproject/specs
   
   Specs to build (3):
     1. feat-auth.md        (MODERATE, Level 4)
     2. feat-user-profile.md (EASY, Level 3)
     3. feat-billing.md     (HIGH, Level 5) [depends: feat-auth]
   
   Lead (claude): Full permissions in working directory
   Validator (codex): Read-only access
   
   Starting in 3 seconds... (Ctrl+C to cancel)
```

### FR-5: Implementation Cycle Execution
The Lead Implementer executes implementation tasks based on the spec.

**Cycle Flow:**
```
1. Send spec + codebase context to Lead
2. Lead generates/modifies code
3. Capture all file changes
4. Log implementation actions
5. Proceed to validation phase
```

**Prompt Template for Lead:**
```
You are implementing a feature defined in the following specification.

SPECIFICATION:
{spec_content}

CURRENT CODEBASE STATE:
{codebase_summary}

PREVIOUS VALIDATION FEEDBACK (if any):
{validation_feedback}

Instructions:
1. Implement the requirements in the specification
2. Follow the acceptance criteria precisely
3. Address any gaps identified in previous validation feedback
4. Explain significant implementation decisions
```

**Validation Criteria:**
- Given a valid spec and empty codebase, When Lead executes, Then new files are created matching spec requirements
- Given validation feedback exists, When Lead executes, Then feedback is included in prompt
- Given Lead execution fails (non-zero exit), Then retry once, then abort with error log
- Implementation actions are logged with timestamps

### FR-6: Validation Cycle Execution
Each Validator analyzes the implementation against the spec.

**Validation Prompt Template:**
```
You are validating an implementation against its specification.

SPECIFICATION:
{spec_content}

IMPLEMENTATION (current codebase):
{codebase_content}

Instructions:
1. Read the codebase thoroughly
2. Compare implementation to each requirement in the spec
3. Identify gaps, missing features, or deviations
4. Rate implementation completeness (0-100%)
5. List specific issues that must be addressed

Response Format:
COMPLETENESS: {percentage}%
STATUS: {PASS|FAIL}
GAPS:
- {gap_1}
- {gap_2}
RECOMMENDATIONS:
- {recommendation_1}
```

**Validation Criteria:**
- Given implementation exists, When Validator executes, Then structured response with completeness % is returned
- Given Validator outputs STATUS: PASS, Then that Validator approves implementation
- Given Validator outputs STATUS: FAIL, Then gaps are extracted and fed to next Lead cycle
- All Validators run in parallel (when possible) to reduce total cycle time

### FR-7: Consensus Detection
The system determines when implementation is complete based on Validator agreement.

**Consensus Rules:**
| Validators | Consensus Requirement |
|------------|----------------------|
| 1 | Single PASS |
| 2 | Both PASS |
| 3 | 2 of 3 PASS (majority) |

**Validation Criteria:**
- Given 2 Validators and both return PASS, When consensus checked, Then session completes successfully
- Given 2 Validators and 1 PASS + 1 FAIL, When consensus checked, Then continue to next cycle
- Given max iterations reached without consensus, When consensus checked, Then exit with partial completion report

### FR-8: Iteration Control
The system enforces iteration limits and provides progress feedback.

**Configuration:**
- `--max-iterations=N` (default: 5)
- `--timeout-per-cycle=M` minutes (default: 10)

**Validation Criteria:**
- Given max-iterations=3 and 3 cycles complete without consensus, Then exit with "Max iterations reached" and summary
- Given a cycle exceeds timeout, Then kill subprocess and count as failed cycle
- Progress displayed after each cycle: "Cycle 2/5: Lead completed, awaiting validation..."

### FR-9: Session State Management
The system maintains session state globally for resumability.

**Global State Directory:** `~/.ai-spec-coordinator/sessions/`

**Project Link:** `.ai-coord` file in working directory contains session ID

**State File:** `~/.ai-spec-coordinator/sessions/{session_id}.json`

**State Schema:**
```json
{
  "session_id": "uuid",
  "working_directory": "/path/to/project",
  "specs_directory": "/path/to/project/specs",
  "lead": "claude",
  "validators": ["codex", "gemini"],
  "config": {
    "max_iterations": 5,
    "stop_on_failure": false
  },
  "status": "in_progress",
  "current_spec_index": 1,
  "specs": [
    {
      "file": "feat-auth.md",
      "path": "/path/to/project/specs/feat-auth.md",
      "meta": {
        "id": "feat-auth",
        "name": "Authentication",
        "complexity": "MODERATE",
        "maturity": 4
      },
      "status": "completed",
      "cycles": [...]
    },
    {
      "file": "feat-billing.md",
      "path": "/path/to/project/specs/feat-billing.md",
      "meta": {
        "id": "feat-billing",
        "name": "Billing System",
        "complexity": "HIGH",
        "maturity": 5,
        "depends_on": ["feat-auth"]
      },
      "status": "in_progress",
      "cycles": [
        {
          "cycle": 1,
          "lead_output": "...",
          "validations": [
            {"tool": "codex", "status": "FAIL", "completeness": 65, "gaps": [...]}
          ]
        }
      ]
    }
  ],
  "started_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

**Validation Criteria:**
- Given a session is interrupted (SIGINT), When coordinator exits, Then state is saved and `.ai-coord` file preserved
- Given `--resume` flag in a directory with `.ai-coord`, When coordinator starts, Then load state and continue from last cycle
- Given `--resume` flag in a directory without `.ai-coord`, When coordinator starts, Then error "No session to resume"
- Given session reaches consensus on all specs, Then state.status = "completed" and `.ai-coord` removed
- Sessions older than 30 days are auto-cleaned on startup via `ai-coord clean`

### FR-10: Output and Reporting
The system provides clear output and generates completion reports.

**Console Output:**
- Real-time progress indicators
- Cycle summaries after each validation
- Final consensus report

**Report File:** `~/.ai-spec-coordinator/reports/{session_id}-report.md`

**Report Contents:**
- Session summary (total specs, success rate, duration)
- Tools used (Lead, Validators)
- Per-spec breakdown:
  - Spec name, complexity, maturity
  - Cycles to consensus (or failure)
  - Final completeness scores
  - Key implementation decisions
- Aggregate statistics
- Failed specs with gap analysis (if any)
- Recommendations for future specs

**Validation Criteria:**
- Given session completes, Then markdown report is generated
- Given `--verbose` flag, Then show full AI tool outputs in console
- Given `--quiet` flag, Then only show final status

### FR-11: Project Initialization
The system provides a command to initialize a new project with the expected structure.

**Command:** `aic init`

**Behavior:**
```bash
$ aic init
Creating specs/ directory...
Creating example spec file...

✓ Initialized ai-spec-coordinator in /home/user/my-project

Created:
  specs/                    # Place your spec files here
  specs/example-feature.md  # Example spec (can be deleted)

Next steps:
  1. Add your spec files to specs/
  2. Run 'aic run --dry-run' to verify setup
  3. Run 'aic run' to start building
```

**Files Created:**
- `specs/` directory
- `specs/example-feature.md` - A sample Spec-MAS feature spec

**Validation Criteria:**
- Given directory has no specs/ folder, When `ai-coord init` runs, Then create specs/ with example
- Given specs/ already exists, When `ai-coord init` runs, Then warn "specs/ already exists" and exit
- Given `--force` flag, When specs/ exists, Then overwrite with fresh example

---

## Non-Functional Requirements

### Performance
- Tool detection: < 2 seconds
- Spec loading and validation: < 1 second
- Inter-cycle overhead (excluding AI execution): < 500ms
- Parallel Validator execution when 2+ Validators available

### Reliability & Scalability
- Handle AI tool crashes gracefully (retry once, then fail cycle)
- Support specs up to 50KB in size
- Support codebases up to 10,000 files (summary-based context)
- No memory leaks across 10+ cycles

### Observability
**Logging:**
- Log file: `.ai-coordinator/logs/{session_id}.log`
- Levels: DEBUG, INFO, WARN, ERROR
- Include timestamps, cycle numbers, tool names

**Metrics (optional future):**
- Cycles to consensus (histogram)
- Tool execution time (per tool)
- Failure rate by tool

### Compliance & Privacy
- No data sent to external services (all processing via local CLI tools)
- Spec content and code remain on local filesystem
- Session state files contain no secrets (paths only, not content)

---

## Security

### Authentication
- No authentication required (local CLI tool)
- Inherits user's filesystem permissions
- AI tools use their own authentication (API keys managed by each tool)

### Authorization
- Read access to spec files and codebase
- Write access to codebase (for implementation)
- Write access to `.ai-coordinator/` directory

### Data Handling
- **PII Classification:** None (processes code specs, not user data)
- **Data Retention:** Session state retained for 7 days, then auto-deleted
- **Data Deletion:** `ai-coord clean` command removes all local state

### Audit & Logging
- All AI tool invocations logged with timestamps
- Prompt content logged at DEBUG level only
- Logs retained for 30 days

---

## Data Model

### Entities

```typescript
// Global paths
const GLOBAL_STATE_DIR = path.join(os.homedir(), '.ai-spec-coordinator');
const SESSIONS_DIR = path.join(GLOBAL_STATE_DIR, 'sessions');
const REPORTS_DIR = path.join(GLOBAL_STATE_DIR, 'reports');
const LOGS_DIR = path.join(GLOBAL_STATE_DIR, 'logs');
const CONFIG_FILE = path.join(GLOBAL_STATE_DIR, 'config.json');

// Project-level
const PROJECT_LINK_FILE = '.ai-coord';  // Contains session ID
const SPECS_DIR = 'specs';               // Relative to working directory

interface Session {
  id: string;                    // UUID v4
  workingDirectory: string;      // Absolute path to project root
  specsDirectory: string;        // Always {workingDirectory}/specs
  specs: SpecEntry[];            // All specs to process
  lead: ToolName;                // 'claude' | 'codex' | 'gemini'
  validators: ToolName[];        // Array of validator tools
  config: SessionConfig;
  status: SessionStatus;
  currentSpecIndex: number;      // Which spec is being processed
  createdAt: Date;
  updatedAt: Date;
}

interface SpecEntry {
  file: string;                  // Filename (e.g., "feat-auth.md")
  path: string;                  // Full path to spec file
  meta: SpecMetadata;            // Extracted from front-matter
  status: SpecStatus;
  cycles: Cycle[];
  startedAt?: Date;
  completedAt?: Date;
}

type SpecStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

interface SpecMetadata {
  id: string;
  name: string;
  complexity: 'EASY' | 'MODERATE' | 'HIGH';
  maturity: number;              // 1-5
  dependsOn?: string[];          // IDs of specs this depends on
}

interface SessionConfig {
  maxIterations: number;         // Default: 5 (per spec)
  timeoutPerCycle: number;       // Minutes, default: 10
  leadPermissions?: string[];    // Optional override (default: full access)
  sandbox: boolean;              // Run in Docker container
  stopOnFailure: boolean;        // Stop session if any spec fails
  verbose: boolean;
  quiet: boolean;
}

interface GlobalConfig {
  defaultLead?: ToolName;        // Preferred lead tool
  defaultMaxIterations: number;  // Default: 5
  defaultTimeout: number;        // Minutes, default: 10
}

type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed' | 'abandoned';

interface Cycle {
  number: number;
  specId: string;                // Which spec this cycle is for
  startedAt: Date;
  completedAt?: Date;
  leadExecution: LeadExecution;
  validations: Validation[];
  consensusReached: boolean;
}

interface LeadExecution {
  tool: ToolName;
  prompt: string;
  output: string;
  filesModified: string[];
  durationMs: number;
  exitCode: number;
}

interface Validation {
  tool: ToolName;
  prompt: string;
  output: string;
  parsed: ValidationResult;
  durationMs: number;
  exitCode: number;
}

interface ValidationResult {
  completeness: number;          // 0-100
  status: 'PASS' | 'FAIL';
  gaps: string[];
  recommendations: string[];
}

type ToolName = 'claude' | 'codex' | 'gemini';

interface ToolRegistry {
  available: Map<ToolName, ToolInfo>;
}

interface ToolInfo {
  name: ToolName;
  command: string;               // CLI command
  version: string;
  path: string;                  // Full path to executable
}
```

### Relationships
- Session has many SpecEntries (1:N)
- SpecEntry has many Cycles (1:N)
- Cycle has one LeadExecution (1:1)
- Cycle has many Validations (1:N, one per Validator)
- SpecEntry may depend on other SpecEntries (N:N via dependsOn)

### Validation Rules
- `Session.specs` must have at least 1 entry
- `Session.validators` must have at least 1 entry
- `Session.lead` must not be in `Session.validators`
- `Session.currentSpecIndex` must be valid index into `Session.specs`
- `SpecEntry.status` must follow valid state transitions (pending → in_progress → completed|failed)
- `Cycle.number` must be sequential starting from 1 within each SpecEntry
- `ValidationResult.completeness` must be 0-100
- `SpecEntry.meta.dependsOn` references must exist in session specs (no missing dependencies)

---

## Interfaces & Contracts

### CLI Interface

**Usage:** Run `aic` (or `ai-coord`) from any project directory containing a `specs/` folder.

```bash
# Navigate to your project
cd /path/to/my-project

# Run the coordinator (discovers specs in ./specs/)
aic run
```

**Commands:**

```bash
# Primary command - build specs in current directory
aic run [options]

# Options - Spec Selection
--specs=<files>         # Specific specs to build (comma-separated or glob)
--exclude=<files>       # Specs to skip

# Options - Role Assignment
--lead=<tool>           # Force specific tool as lead (claude|codex|gemini)
--validators=<tools>    # Comma-separated validator list

# Options - Execution Control
--max-iterations=<n>    # Max cycles per spec before abort (default: 5)
--timeout=<minutes>     # Per-cycle timeout (default: 10)
--resume                # Resume last interrupted session in this directory
--stop-on-failure       # Stop if any spec fails consensus (default: continue)

# Options - Permission Overrides (optional, defaults are role-based)
--lead-permissions=<list>  # Restrict Lead to specific tools (default: full access)
--sandbox                  # Run in Docker container (most secure)
--interactive              # Pause for each permission prompt (debugging)

# Options - Output
--verbose               # Show full AI outputs
--quiet                 # Minimal output
--dry-run               # Validate setup, list specs, without running

# Utility commands
aic init               # Initialize specs/ directory with example spec
aic specs              # List specs in ./specs/ with status  
aic status             # Show current/last session status for this directory
aic tools              # List available AI tools globally
aic config [key=value] # View or set global configuration
aic clean              # Remove old sessions/logs from ~/.ai-spec-coordinator
aic --version          # Show version
aic --help             # Show help
```

**Note:** `ai-coord` and `aic` are interchangeable. Use whichever you prefer.

**Examples:**

```bash
# Build all specs in current project
cd ~/projects/my-app
aic run

# Build specific specs only
aic run --specs feat-auth.md,feat-billing.md

# Use Codex as lead instead of Claude
aic run --lead=codex

# Resume an interrupted session
aic run --resume

# Dry run to see what would be built
aic run --dry-run

# Initialize a new project
mkdir my-new-project && cd my-new-project
aic init
```

### AI Tool Interface

**Invocation Patterns (role-based permissions):**

```bash
# Claude Code - Lead (full access in working directory)
claude --dangerously-skip-permissions -p "{prompt}" 2>&1

# Claude Code - Validator (read-only)
claude --allowedTools "View,Read,Grep,Glob,LS" -p "{prompt}" 2>&1

# OpenAI Codex - Lead (full access)
codex --approval-mode full-auto "{prompt}" 2>&1

# OpenAI Codex - Validator (read-only)
codex --approval-mode read-only "{prompt}" 2>&1

# Gemini CLI - Lead (full access)
gemini --non-interactive prompt "{prompt}" 2>&1

# Gemini CLI - Validator (read-only, flag TBD)
gemini --non-interactive --read-only prompt "{prompt}" 2>&1
```

**Adapter Responsibility:**
Each tool adapter must:
1. Detect tool version and available flags
2. Apply role-appropriate permission flags (Lead = full, Validator = read-only)
3. Scope all operations to the working directory
4. Fall back gracefully if read-only mode unavailable (log warning, use full with audit)

**Role-Permission Mapping (Default):**

| Role | Claude Code | Codex | Gemini |
|------|-------------|-------|--------|
| Lead | `--dangerously-skip-permissions` | `--approval-mode full-auto` | `--non-interactive` |
| Validator | `--allowedTools "View,Read,Grep,Glob,LS"` | `--approval-mode read-only` | `--non-interactive --read-only` |

**Note:** Actual flags may vary by tool version. Adapters must version-detect and adjust.

### Events (Internal)

**Event: CycleCompleted**
```typescript
{
  sessionId: string;
  specId: string;
  cycleNumber: number;
  leadDurationMs: number;
  validationResults: ValidationResult[];
  consensusReached: boolean;
}
```

**Event: SpecCompleted**
```typescript
{
  sessionId: string;
  specId: string;
  status: 'completed' | 'failed';
  totalCycles: number;
  durationMs: number;
}
```

**Event: SessionCompleted**
```typescript
{
  sessionId: string;
  totalSpecs: number;
  completedSpecs: number;
  failedSpecs: number;
  finalStatus: 'completed' | 'partial' | 'failed';
  totalDurationMs: number;
}
```

---

## Deterministic Tests

```json
{
  "id": "DT-001",
  "description": "Tool detection finds Claude when installed",
  "preconditions": "claude command exists in PATH, returns version",
  "input": "detectTools()",
  "expected": "registry.available.has('claude') === true"
}
```

```json
{
  "id": "DT-002", 
  "description": "Session fails with only one tool available",
  "preconditions": "Only claude installed",
  "input": "startSession({workingDir: './project'})",
  "expected": "throws Error('At least 2 AI tools required')"
}
```

```json
{
  "id": "DT-003",
  "description": "Consensus reached with 2/2 PASS votes",
  "input": "checkConsensus([{status:'PASS'}, {status:'PASS'}])",
  "expected": "true"
}
```

```json
{
  "id": "DT-004",
  "description": "Consensus not reached with 1/2 PASS votes",
  "input": "checkConsensus([{status:'PASS'}, {status:'FAIL'}])",
  "expected": "false"
}
```

```json
{
  "id": "DT-005",
  "description": "Majority consensus with 2/3 PASS votes",
  "input": "checkConsensus([{status:'PASS'}, {status:'PASS'}, {status:'FAIL'}])",
  "expected": "true"
}
```

```json
{
  "id": "DT-006",
  "description": "Session state saved on SIGINT with current spec index",
  "preconditions": "Session in progress, spec index 1, cycle 2",
  "input": "process.emit('SIGINT')",
  "expected": "State file exists with status='abandoned', current_spec_index=1, specs[1].cycles.length=2"
}
```

```json
{
  "id": "DT-007",
  "description": "Lead role applies full permission flags to Claude Code",
  "input": "buildClaudeCommand({role: 'lead', prompt: 'test'})",
  "expected": "Contains '--dangerously-skip-permissions'"
}
```

```json
{
  "id": "DT-008",
  "description": "Validator role applies read-only flags to Claude Code",
  "input": "buildClaudeCommand({role: 'validator', prompt: 'test'})",
  "expected": "Contains '--allowedTools' with read-only tools"
}
```

```json
{
  "id": "DT-009",
  "description": "Specs discovered from specs/ directory",
  "preconditions": "specs/ contains feat-a.md, feat-b.md, readme.txt",
  "input": "discoverSpecs('./project')",
  "expected": "Returns [{file:'feat-a.md',...}, {file:'feat-b.md',...}] (readme.txt excluded)"
}
```

```json
{
  "id": "DT-010",
  "description": "Specs ordered by dependencies",
  "preconditions": "feat-b.md has depends_on: ['feat-a']",
  "input": "orderSpecs([{id:'feat-b', dependsOn:['feat-a']}, {id:'feat-a'}])",
  "expected": "[{id:'feat-a'}, {id:'feat-b'}]"
}
```

```json
{
  "id": "DT-011",
  "description": "Empty specs directory returns error",
  "preconditions": "specs/ directory exists but is empty",
  "input": "discoverSpecs('./project')",
  "expected": "throws Error('No specs found in ./specs/')"
}
```

```json
{
  "id": "DT-012",
  "description": "Init creates specs directory and example",
  "preconditions": "Directory exists without specs/",
  "input": "initProject('./my-project')",
  "expected": "Creates specs/ directory and specs/example-feature.md"
}
```

```json
{
  "id": "DT-013",
  "description": "Init fails if specs/ already exists",
  "preconditions": "specs/ directory exists",
  "input": "initProject('./my-project')",
  "expected": "throws Error('specs/ already exists')"
}
```

```json
{
  "id": "DT-014",
  "description": "Resume finds session from .ai-coord file",
  "preconditions": ".ai-coord contains session-id, session exists in ~/.ai-spec-coordinator/sessions/",
  "input": "resumeSession('./my-project')",
  "expected": "Loads session and returns current spec index"
}
```

```json
{
  "id": "DT-015",
  "description": "Resume fails when no .ai-coord file exists",
  "preconditions": "No .ai-coord file in directory",
  "input": "resumeSession('./my-project')",
  "expected": "throws Error('No session to resume')"
}
```

```json
{
  "id": "DT-016",
  "description": "Both aic and ai-coord commands resolve to same entry point",
  "preconditions": "Package installed globally",
  "input": "which aic && which ai-coord",
  "expected": "Both commands exist and point to same dist/cli/index.js"
}
```

---

## Acceptance Tests

### User Stories

**Story 1:** As a developer, I want to run all specs in my project through AI implementation and validation, so that I get a complete implementation with minimal manual intervention.

**Story 2:** As a developer, I want to resume an interrupted coordination session, so that I don't lose progress if my machine restarts mid-way through multiple specs.

**Story 3:** As a developer, I want specs with dependencies to be processed in the correct order, so that later specs can build on earlier implementations.

**Story 4:** As a developer, I want to see which specs are in my project and their status, so that I can track implementation progress.

### Acceptance Criteria

- [x] Given `npm install -g ai-spec-coordinator`, When installation completes, Then both `aic` and `ai-coord` commands are available in PATH
- [x] Given specs/ directory with valid specs, When `aic run` executes, Then all specs are discovered and processed
- [x] Given `--specs feat-auth.md` flag, When session starts, Then only feat-auth.md is processed
- [x] Given spec with `depends_on: [feat-auth]`, When ordering, Then feat-auth processed first
- [x] Given default configuration, When Lead executes, Then full read/write permissions in working directory
- [x] Given default configuration, When Validator executes, Then read-only permissions applied
- [x] Given `--sandbox` flag, When session starts, Then spawn Docker container with codebase mounted
- [x] Given Claude and Codex available, When run without flags, Then Claude is Lead and Codex is Validator
- [x] Given `--lead=codex` flag, When session starts, Then Codex is assigned as Lead
- [x] Given Validator returns STATUS: FAIL with gaps, When cycle completes, Then gaps are fed to next Lead cycle
- [x] Given all Validators return STATUS: PASS, When consensus checked, Then spec marked complete, move to next
- [x] Given max-iterations reached for a spec, When cycle completes, Then spec marked failed, continue to next (unless --stop-on-failure)
- [x] Given session interrupted with Ctrl+C, When restarted with `--resume`, Then continues from current spec and cycle
- [x] Given `aic init` in empty directory, When executed, Then create specs/ with example spec
- [x] Given `aic specs` command, When executed, Then display table of specs in ./specs/ with status
- [x] Given session completes, When finished, Then markdown report generated in ~/.ai-spec-coordinator/reports/

---

## Architectural Patterns

### Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Interface                            │
│                    (Commander.js)                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Session Orchestrator                       │
│  - Manages cycle flow                                        │
│  - Coordinates Lead/Validator execution                      │
│  - Checks consensus                                          │
└─────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   ▼                    ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│  Tool Registry  │ │  State Manager  │ │  Report Generator   │
│  - Detection    │ │  - Persistence  │ │  - Markdown output  │
│  - Adapters     │ │  - Resume logic │ │  - Console summary  │
└─────────────────┘ └─────────────────┘ └─────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Tool Adapters                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Claude    │  │   Codex     │  │   Gemini    │          │
│  │   Adapter   │  │   Adapter   │  │   Adapter   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### Design Patterns Used
- **Adapter Pattern:** Normalize different AI CLI interfaces
- **Strategy Pattern:** Swap Lead/Validator roles dynamically
- **State Pattern:** Manage session lifecycle (pending → in_progress → completed)
- **Observer Pattern:** Emit events on cycle/session completion for extensibility

### Error Handling Strategy
- **Retry once** on AI tool failure (non-zero exit)
- **Graceful degradation:** If one Validator fails, continue with remaining
- **Fail-fast:** Invalid spec or missing tools abort before any execution
- **State preservation:** Always save state before exit (clean or crash)

---

## Observability

### Logging Configuration

**Log Location:** `~/.ai-spec-coordinator/logs/{date}.log`

**Log Levels:**
| Level | Content |
|-------|---------|
| ERROR | Tool failures, unrecoverable errors |
| WARN | Retries, timeouts, low maturity specs |
| INFO | Cycle starts/ends, consensus results |
| DEBUG | Full prompts, AI outputs, timing details |

**Log Format:**
```
[2025-01-15T10:30:00Z] [INFO] [session:abc123] [/home/user/my-project] Cycle 2 started
[2025-01-15T10:30:05Z] [INFO] [session:abc123] [feat-auth] Lead (claude) completed in 4532ms
[2025-01-15T10:30:15Z] [INFO] [session:abc123] [feat-auth] Validator (codex) result: PASS (87%)
```

**Log Rotation:**
- New log file per day
- Logs older than 30 days auto-deleted by `ai-coord clean`

### Metrics (Future Enhancement)
- `ai_coord_cycles_total` - Counter of total cycles run
- `ai_coord_consensus_cycles` - Histogram of cycles needed for consensus
- `ai_coord_tool_duration_seconds` - Histogram by tool name

### Alerting Thresholds
- Session stuck > 30 minutes → Log WARN
- Tool failure rate > 50% → Log ERROR with diagnostics

---

## Risks & Open Questions

### Risks

**R-1: AI Tool Output Parsing Failures**
- **Impact:** High - Validation results cannot be extracted
- **Probability:** Medium - AI output format can vary
- **Mitigation:** Implement fuzzy parsing with fallback patterns; require structured output format

**R-2: Tool CLI Interface Changes**
- **Impact:** Medium - Adapters may break with tool updates
- **Probability:** Medium - AI tools are actively developed
- **Mitigation:** Version detection and adapter versioning; community contribution for updates

**R-3: Infinite Loops in Edge Cases**
- **Impact:** Low - Cycles are capped by max-iterations
- **Probability:** Low - Hard limit prevents runaway
- **Mitigation:** Max iterations enforced; timeout per cycle

**R-4: Large Codebase Context Limits**
- **Impact:** Medium - AI tools have context limits
- **Probability:** Medium - Enterprise codebases are large
- **Mitigation:** Codebase summarization strategy; focus on changed files

**R-5: Global State Directory Permissions**
- **Impact:** Low - Tool cannot save state
- **Probability:** Low - Home directory usually writable
- **Mitigation:** Check permissions on first run; provide clear error message

**R-6: npm Global Install Path Issues**
- **Impact:** Medium - Command not found after install
- **Probability:** Low - Standard npm behavior
- **Mitigation:** Post-install script checks PATH; README includes troubleshooting

### Open Questions

**Q-1: Should we support API-based AI access in addition to CLI?**
- **Owner:** Product decision
- **Due:** Before v1.1 planning
- **Current stance:** CLI-only for v1.0 (simpler, uses existing auth)

**Q-2: How to handle AI tools that require interactive authentication?**
- **Owner:** Engineering
- **Due:** Before implementation
- **Proposed:** Pre-flight check that runs tool with simple prompt; fail if auth required

**Q-3: Should validation feedback be cumulative or latest-only?**
- **Owner:** Engineering
- **Due:** Implementation
- **Proposed:** Cumulative (last 3 cycles) to show progress and prevent regression

**Q-4: What if a tool doesn't support read-only mode for Validators?**
- **Owner:** Engineering
- **Due:** Before implementation
- **Proposed:** Fall back to full permissions with audit logging. Log all file operations performed by Validator to detect unintended writes. Warn user at startup.
- **Current stance:** Most tools support scoped permissions; this is an edge case

**Q-5: Should working directory scope be enforced by the coordinator or delegated to tools?**
- **Owner:** Engineering
- **Due:** Implementation
- **Proposed:** Both — use tool flags where available, but also validate cwd before execution and reject specs that reference paths outside working directory

---

## Implementation Notes

### Technology Stack
- **Runtime:** Node.js 20+ (for modern async/await, native fetch)
- **CLI Framework:** Commander.js
- **Process Management:** execa (for subprocess handling)
- **State Storage:** JSON files (simple, no external dependencies)
- **Logging:** pino (fast, structured logging)

### File Structure

**Package Structure (what gets published to npm):**
```
ai-spec-coordinator/
├── dist/                      # Compiled output
│   ├── cli/
│   │   └── index.js           # CLI entry point (with shebang)
│   ├── core/
│   ├── adapters/
│   ├── discovery/
│   ├── state/
│   ├── reporting/
│   └── utils/
├── src/                       # TypeScript source
│   ├── cli/
│   │   ├── index.ts           # CLI entry point
│   │   └── commands/          # Command handlers
│   │       ├── run.ts
│   │       ├── init.ts
│   │       ├── specs.ts
│   │       ├── status.ts
│   │       └── tools.ts
│   ├── core/
│   │   ├── orchestrator.ts    # Main coordination logic
│   │   ├── consensus.ts       # Consensus checking
│   │   ├── spec-queue.ts      # Multi-spec queue management
│   │   └── prompts.ts         # Prompt templates
│   ├── adapters/
│   │   ├── base.ts            # Abstract adapter
│   │   ├── claude.ts          # Claude Code adapter
│   │   ├── codex.ts           # OpenAI Codex adapter
│   │   └── gemini.ts          # Gemini CLI adapter
│   ├── discovery/
│   │   ├── specs.ts           # Spec discovery in specs/
│   │   ├── dependencies.ts    # Dependency ordering
│   │   └── validation.ts      # Spec validation
│   ├── state/
│   │   └── manager.ts         # Session state management
│   ├── reporting/
│   │   └── generator.ts       # Report generation
│   ├── templates/
│   │   └── example-feature.md # Template for ai-coord init
│   └── utils/
│       ├── detection.ts       # Tool detection
│       ├── paths.ts           # Path utilities
│       └── spec-parser.ts     # Spec file parsing
├── package.json
├── tsconfig.json
└── README.md
```

**Global State Location (created on first run):**
```
~/.ai-spec-coordinator/
├── config.json              # Global configuration
│   {
│     "defaultLead": "claude",
│     "defaultMaxIterations": 5,
│     "defaultTimeout": 10
│   }
├── sessions/                # All session state files
│   └── {session-id}.json
├── reports/                 # Generated reports
│   └── {session-id}-report.md
└── logs/                    # Log files
    └── {date}.log
```

**User's Project Structure (expected layout):**
```
my-project/                  # User runs 'aic run' here
├── specs/                   # Required: spec files live here
│   ├── feat-auth.md
│   ├── feat-billing.md
│   └── system-architecture.md
├── src/                     # Implementation target (varies by project)
├── .ai-coord                # Created by tool: links to current session
└── package.json             # User's project config
```

### Estimated Implementation Time
- **Phase 1 - Core:** Tool detection, single-spec orchestration (3-4 days)
- **Phase 2 - Multi-Spec:** Spec discovery, dependency ordering, queue management (2-3 days)
- **Phase 3 - State:** Session management, resume capability, multi-spec tracking (2 days)
- **Phase 4 - Reporting:** Console output, per-spec markdown reports (1-2 days)
- **Phase 5 - Polish:** Error handling, edge cases, testing (2-3 days)
- **Total:** ~12-14 days

---

## Glossary & Definitions

- **aic:** Short alias for `ai-coord` command (both are interchangeable)
- **Lead Implementer:** The AI tool responsible for writing/modifying code based on the spec
- **Validator:** AI tool(s) that review implementation against the spec and identify gaps
- **Consensus:** Agreement among Validators that implementation meets spec requirements
- **Cycle:** One complete iteration of Lead implementation + Validator review for a single spec
- **Session:** A complete coordination run across all specs from start to completion
- **Spec Queue:** Ordered list of specs to process, respecting dependencies
- **Gap:** A discrepancy between the spec requirements and current implementation
- **Spec-MAS:** Specification-Guided Multi-Agent System pattern
- **Working Directory:** The project root where `aic` is run and implementation occurs
- **Specs Directory:** Always `<working_dir>/specs/` - location of all spec files
- **Global State:** Session data stored in `~/.ai-spec-coordinator/` (persists across projects)
- **Project Link:** `.ai-coord` file in working directory linking to active session

---

**Status:** ✅ Complete - Level 4  
**Agent Ready:** ✅ Yes  
**Required Level:** 4 (MODERATE complexity)  
**Validation:** All required sections present, deterministic tests defined, architectural patterns specified
