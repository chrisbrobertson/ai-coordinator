# Architecture Overview

## Orchestration Flow
1. Discover specs in `./specs/` and parse Spec-MAS front matter.
2. Order feature specs by `depends_on` and filename.
3. For each spec:
   - Lead tool executes the implementation prompt.
   - Validator tools review the codebase against the spec.
   - Repeat until consensus or `--max-iterations`.
4. Persist session state and write reports.

## Lead vs Validator Roles
- Lead tools implement the spec and modify the codebase.
- Validators read the codebase and return a structured gap report.

## Consensus Rules
- 1 validator: pass if it returns PASS.
- 2 validators: pass only if both return PASS.
- 3+ validators: pass if at least 2 return PASS.

## Tool Runner
- Runs tools in headless mode with JSON output where possible.
- Enforces timeouts and captures stdout/stderr.
- Writes tool output to reports under `./.ai-coord/reports/`.

## Session State
- Stored in `./.ai-coord/sessions/<session-id>.json`.
- The current session id is stored in `./.ai-coord/session` for `--resume`.
- Reports and logs are keyed by session id.

## Permissions and Sandbox
- Claude lead uses full permissions by default.
- Validators run in read-only mode where supported.
- `--sandbox` runs tools in Docker if configured.
