# AI Spec Coordinator

CLI to orchestrate multiple AI coding assistants against Spec-MAS feature specs.

## Requirements
- Node.js 20+
- At least two AI CLI tools available on PATH (claude, codex, gemini)

## Install (from source)
```bash
./scripts/install.sh
```

To expose the CLI locally via npm link:
```bash
./scripts/install.sh --link
```

Skip the build step if you only need dependencies:
```bash
./scripts/install.sh --skip-build
```

## Install (global)
```bash
npm install -g ai-spec-coordinator
```

## Quick Start
```bash
# Initialize specs folder
npx aic init

# Run all specs in ./specs
npx aic run
```

## How It Works
1. Discover specs in `./specs/` with Spec-MAS front matter.
   - Front matter must start at the first line (`---` at byte 0).
2. Order feature specs by `depends_on`/`dependsOn` (context-only `system-*.md` are prepended).
3. For each spec:
   - Lead tool implements the spec.
   - Validator tools review and report gaps.
   - Repeat until consensus or `--max-iterations`.
4. Reports and session state are written under `./.ai-coord/`.

## How Specs Are Processed
- Specs are discovered from `./specs/*.md` with valid Spec-MAS front matter.
- Files starting with `system-` are treated as context-only and not built directly.
- Feature specs are ordered by `depends_on`/`dependsOn` in front matter, then filename.
- Each spec runs to consensus or `--max-iterations` before moving to the next spec.

## Where Output Goes
- Project state, reports, and sessions are stored under `./.ai-coord/`.
- Global state lives in `~/.ai-spec-coordinator/` and should not be committed.

## Quick Troubleshooting
- Tools not found? Run `aic tools` and confirm CLI tools are on PATH.
- Need more detail? Use `--verbose --heartbeat 5`.
- Stuck or failing cycles? Check reports and logs in `./.ai-coord/`.

## Docs
- `docs/INSTALL.md`
- `docs/DEBUGGING.md`
- `docs/EXAMPLES.md`
- `docs/ARCHITECTURE.md`
- `docs/SESSION_STATE.md`

## Commands
```bash
aic run [options]
aic tools
aic init
aic specs
aic status [--full]
aic config [key=value]
aic clean
```

## Run Options
```bash
--specs <files>         # Comma-separated list or glob of specs to include
--exclude <files>       # Comma-separated list or glob of specs to exclude
--lead <tool>           # Force lead tool (claude|codex|gemini)
--validators <tools>    # Comma-separated list of validator tools
--max-iterations <n>    # Max cycles per spec (default: 5)
--timeout <minutes>     # Per-cycle timeout in minutes (default: 10)
--resume                # Resume last session
--stop-on-failure       # Stop on first spec failure
--lead-permissions <list> # Override lead permissions (Claude only)
--sandbox               # Run in Docker sandbox
--interactive           # Interactive mode
--verbose               # Stream tool output
--heartbeat <seconds>   # Verbose heartbeat interval (0 disables)
--quiet                 # Minimal output
--dry-run               # List specs and exit
```

## Status Options
```bash
--full                  # Full per-spec status details
```

## Testing
```bash
npm test
```

## Build
```bash
npm run build
```

## Project State
Global session state lives in `~/.ai-spec-coordinator/` and should not be committed.
