# Session State

## Locations
- Session files: `./.ai-coord/sessions/<session-id>.json`
- Session pointer: `./.ai-coord/session`
- Reports: `./.ai-coord/reports/`
- Logs: `./.ai-coord/logs/`

Global state (shared across projects):
- `~/.ai-spec-coordinator/sessions/`
- `~/.ai-spec-coordinator/reports/`
- `~/.ai-spec-coordinator/logs/`

## File Shape (High Level)
Session files include:
- `id`, `workingDirectory`, `specsDirectory`
- `specs[]` with per-spec status, cycles, and metadata
- `currentSpecIndex` for resume progress
- `config` snapshot for the run
- `createdAt`, `updatedAt`

Each cycle contains:
- Lead prompt + output + duration
- Validator outputs + parsed results
- Consensus flag

## Resuming
- `aic run --resume` reads `./.ai-coord/session` to find the last session id.
- If the pointer file is missing, `--resume` fails.

## Manual Recovery (Safe)
1. Back up the session JSON.
2. Remove `./.ai-coord/session` if you want a fresh run.
3. Keep reports/logs for debugging.

Avoid editing session JSON unless you are certain of the impact.
