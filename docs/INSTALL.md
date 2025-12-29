# Installation

## From Source
```bash
./scripts/install.sh
```

Optional flags:
- `--link` to `npm link` the CLI for local usage
- `--skip-build` to skip compilation

## Global Install (npm)
```bash
npm install -g ai-spec-coordinator
```

## Verify
```bash
aic --version
ai-coord --version
```

## Usage Flags
```bash
aic run [options]

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

aic status [--full]
```

## Troubleshooting
- If aic/ai-coord are not found, ensure npm global bin is on PATH.
- Tool detection requires at least two AI CLIs installed (claude, codex, gemini).
