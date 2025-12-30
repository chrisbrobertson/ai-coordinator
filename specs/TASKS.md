# Pending Fixes

## Tests
- Add gemini CLI terminal handling integration test once gemini CLI is available.

## Completed
- Added sandbox-mode TTY test for codex/cortex to ensure pseudo-tty wrapping is skipped in Docker mode.
- Added CLI status output tests for summary vs `--full` (including previous session history formatting).
- Added validation parser tests for inferred PASS/FAIL without a `STATUS:` line.
- Added low-maturity confirmation prompt tests (accept + decline flows).
