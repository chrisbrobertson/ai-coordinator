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

## Troubleshooting
- If aic/ai-coord are not found, ensure npm global bin is on PATH.
- Tool detection requires at least two AI CLIs installed (claude, codex, gemini).
