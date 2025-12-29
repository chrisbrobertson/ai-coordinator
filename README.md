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
