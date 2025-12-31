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
--preflight-threshold <n> # Preflight completeness threshold (default: 70)
--preflight-iterations <n> # Max validation cycles in preflight mode (default: 2)
--resume                # Resume last session
--stop-on-failure       # Stop on first spec failure
--lead-permissions <list> # Override lead permissions (Claude only)
--sandbox               # Run in Docker sandbox
--interactive           # Interactive mode
--verbose               # Stream tool output
--heartbeat <seconds>   # Verbose heartbeat interval (0 disables)
--quiet                 # Minimal output
--dry-run               # List specs and exit
--start-over            # Ignore previous session state and start fresh
--no-preflight          # Disable preflight validation on existing code

aic status [--full]
```

## How Specs Are Processed
- Specs are discovered from `./specs/*.md` with valid Spec-MAS front matter.
- Files named `system-*.md` are context-only and not built directly.
- Feature specs are ordered by `depends_on`/`dependsOn` (then filename).
- Each spec runs to consensus or `--max-iterations` before advancing.

## Where Output Goes
- Project sessions/reports/logs: `./.ai-coord/`
- Global state: `~/.ai-spec-coordinator/` (do not commit)

## Troubleshooting
- If aic/ai-coord are not found, ensure npm global bin is on PATH.
- Tool detection requires at least two AI CLIs installed (claude, codex, gemini).
- `aic tools` shows which CLIs are detected and which are missing.
- Permission/auth errors often mean the CLI tool needs login (e.g., `claude /login`).
- If the run fails early, inspect `./.ai-coord/logs/<session>.log`.
- Validators output is stored in `./.ai-coord/reports/` for each cycle.
- If consensus is not reached, rerun with higher `--max-iterations` or fix gaps first.
- For more signal, run with `--verbose --heartbeat 5`.
- If `--resume` fails, remove `./.ai-coord/session` to start a fresh run.
- Sandbox issues: ensure Docker is running and `AIC_SANDBOX_IMAGE` is set if needed.
- Timeouts: increase `--timeout` (minutes) for large specs or slow tools.

## Next Steps
- Run `aic init` to create a starter spec.
- Use `aic run --dry-run` to preview ordered specs before executing.
- See `docs/EXAMPLES.md` and `docs/DEBUGGING.md` for walkthroughs.
