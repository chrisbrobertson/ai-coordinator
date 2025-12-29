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
aic status
aic config [key=value]
aic clean
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
