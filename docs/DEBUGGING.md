# Debugging Guide

## Enabling Debug Output
- `--verbose` streams tool output as it runs.
- `--heartbeat <seconds>` prints periodic heartbeat lines in verbose mode.
- `--quiet` minimizes output (useful for CI logs).
- Preflight validation can be disabled with `--no-preflight`.
- Use `--start-over` to ignore prior session state.

Example:
```bash
aic run --verbose --heartbeat 5
```

## Logs and Reports
- Per-run logs: `./.ai-coord/logs/<session-id>.log`
- Lead/validator reports: `./.ai-coord/reports/<session-id>-<spec>-cycle-<n>-<tool>.md`
- Session state: `./.ai-coord/sessions/<session-id>.json`
- Session pointer: `./.ai-coord/session` (last run id for `--resume`)

## Understanding Session State
Session files include:
- Spec list and order
- Per-spec status and cycles
- Lead/validator outputs per cycle
- Current spec index for `--resume`

See `docs/SESSION_STATE.md` for field details.

## Common Issues
### Tools Not Detected
- Run `aic tools` to see missing CLIs.
- Confirm `claude`, `codex`, or `gemini` are on PATH.

### Auth or Permission Errors
- Most CLIs require login (e.g., `claude /login`).
- If tools cannot write to HOME in CI, set `AIC_TOOL_HOME`.

### Validator Output Missing
- Check the validator report in `./.ai-coord/reports/`.
- Ensure the tool supports headless mode and JSON output.

### Consensus Not Reached
- Inspect validator gaps in reports and address them.
- Re-run with a higher `--max-iterations` if needed.

### Timeouts
- Increase `--timeout` for large specs or slower tool responses.
- Keep an eye on the verbose output for stalled steps.

## Manual Recovery
- To resume a run: `aic run --resume`
- To start fresh: remove `./.ai-coord/session` and rerun.
- If a session is corrupted, delete the session file and rerun.

## Getting Help
- Share the session report and log file when asking for support.
- Include the command used and tool versions.
