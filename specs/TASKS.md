# Pending Fixes

## Tests
- Add a sandbox-mode TTY test for codex/cortex to ensure pseudo-tty wrapping is skipped in Docker mode.
- Add CLI status output tests for summary vs `--full` (including previous session history formatting).
- Add validation parser tests for inferred PASS/FAIL without a `STATUS:` line.
- Add low-maturity confirmation prompt tests (accept + decline flows).
